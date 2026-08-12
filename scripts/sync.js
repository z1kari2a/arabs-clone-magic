#!/usr/bin/env node
// Two-way sync between the local SQLite store (electron/db.cjs) and Appwrite.
//
//   node scripts/sync.js                 # push, then pull
//   node scripts/sync.js --push          # local -> Appwrite only
//   node scripts/sync.js --pull          # Appwrite -> local only
//   node scripts/sync.js --dry-run       # report what would move, write nothing
//   node scripts/sync.js --table=items,suppliers
//
// PUSH  reads every record whose local content no longer matches the hash
//       Appwrite last confirmed (`erp_sync_state.synced = 0`) and upserts it.
//       Records that disappeared locally are pushed as soft deletes.
// PULL  asks each collection for documents with $updatedAt newer than the last
//       cursor, and merges them back into the local JSON blobs.
//
// Push runs before pull, so when the same record changed in both places the
// local edit wins: it lands remotely first, and the pull then sees its own
// write. Every network call goes through withRetry(), and a failure on one
// record is logged and skipped rather than aborting the run.

import { Query } from "node-appwrite";
import { makeClient, errCode, NOT_FOUND } from "./appwrite/client.js";
import { SYNCED } from "./appwrite/schema.js";
import { LocalStore, defaultSqlitePath, hashRecord, docIdFor } from "./appwrite/local-store.js";
import { loadSqlite, relaunchUnderElectron, ABI_HELP } from "./appwrite/sqlite.js";
import { log, withRetry } from "./appwrite/log.js";

const PAGE = 100;
const EPOCH = "1970-01-01T00:00:00.000Z";

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const DRY_RUN = has("--dry-run");
const only = (() => {
  const arg = argv.find((a) => a.startsWith("--table="));
  return arg
    ? new Set(
        arg
          .slice("--table=".length)
          .split(",")
          .map((s) => s.trim()),
      )
    : null;
})();
const DO_PUSH = has("--push") || !has("--pull");
const DO_PULL = has("--pull") || !has("--push");

const totals = { pushed: 0, softDeleted: 0, pulled: 0, removed: 0, failed: 0 };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Full remote projection of a record, children included — this is what the dirty hash covers. */
function projector(spec) {
  const { toRemote, children } = spec.sync;
  if (!children?.length) return (record) => toRemote(record);
  return (record) => ({
    ...toRemote(record),
    __children: children.map((child) =>
      lineNumbered(record?.[child.field] ?? []).map(({ row, lineNo }) =>
        child.toRemote(row, lineNo),
      ),
    ),
  });
}

/**
 * Assigns each nested row a stable line number. The local row `id` is used when
 * it is a usable, non-duplicate number; otherwise the position is. Duplicates
 * would collide on the unique (scope, parent, line_no) index.
 */
function lineNumbered(rows) {
  const used = new Set();
  return rows.map((row, index) => {
    const candidate = Number(row?.id);
    const lineNo =
      Number.isInteger(candidate) && candidate > 0 && !used.has(candidate) ? candidate : index + 1;
    used.add(lineNo);
    return { row, lineNo };
  });
}

const parentField = (child) => child.parentKey ?? "po_number";

/** Pages through listDocuments until the collection is exhausted. */
async function listAll(databases, databaseId, collectionId, queries, label) {
  const out = [];
  let cursor = null;
  for (;;) {
    const page = [...queries, Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
    const res = await withRetry(`${label} ${collectionId}`, () =>
      databases.listDocuments({ databaseId, collectionId, queries: page }),
    );
    out.push(...res.documents);
    if (res.documents.length < PAGE) return out;
    cursor = res.documents.at(-1).$id;
  }
}

const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );

// ── PUSH ─────────────────────────────────────────────────────────────────────

async function pushChildren(ctx, child, parentKeyValue, rows) {
  const { databases, cfg } = ctx;
  const field = parentField(child);
  const wanted = new Map();

  for (const { row, lineNo } of lineNumbered(rows)) {
    const naturalKey = `${parentKeyValue}#${lineNo}`;
    wanted.set(docIdFor(cfg.scope, child.collection, naturalKey), {
      ...child.toRemote(row, lineNo),
      [field]: parentKeyValue,
      sync_scope: cfg.scope,
      local_key: naturalKey,
      deleted: false,
    });
  }

  for (const [docId, data] of wanted) {
    await withRetry(`upsert ${child.collection}/${data.local_key}`, () =>
      databases.upsertDocument({
        databaseId: cfg.databaseId,
        collectionId: child.collection,
        documentId: docId,
        data,
      }),
    );
  }

  // Rows removed from the parent must disappear remotely too.
  const existing = await listAll(
    databases,
    cfg.databaseId,
    child.collection,
    [Query.equal("sync_scope", cfg.scope), Query.equal(field, parentKeyValue)],
    "list children",
  );
  for (const doc of existing) {
    if (wanted.has(doc.$id)) continue;
    await withRetry(`delete ${child.collection}/${doc.$id}`, () =>
      databases.deleteDocument({
        databaseId: cfg.databaseId,
        collectionId: child.collection,
        documentId: doc.$id,
      }),
    );
    log.debug(`  - ${child.collection}/${doc.local_key} (row removed)`);
  }
}

async function pushCollection(ctx, spec) {
  const { store, databases, cfg } = ctx;
  const { localTable, key: keyField, children = [] } = spec.sync;
  const project = projector(spec);

  const records = store.readTable(localTable);
  store.refreshDirty(localTable, records, keyField, project, spec.id);

  const pending = store.pendingStates(localTable);
  if (pending.length === 0) {
    log.info(`${spec.id}: nothing to push (${records.length} local record(s), all in sync)`);
    return;
  }

  const byKey = new Map(
    records.filter((r) => r?.[keyField] != null).map((r) => [String(r[keyField]), r]),
  );
  log.step(`${spec.id}: pushing ${pending.length} change(s)`);

  for (const state of pending) {
    const recordKey = state.record_key;
    try {
      if (state.deleted === 1) {
        if (DRY_RUN) {
          log.info(`  [dry-run] would soft-delete ${spec.id}/${recordKey}`);
          continue;
        }
        // Soft delete: a hard delete is invisible to another device that only
        // watches $updatedAt, so the tombstone has to be a document.
        try {
          await withRetry(`soft-delete ${spec.id}/${recordKey}`, () =>
            databases.updateDocument({
              databaseId: cfg.databaseId,
              collectionId: spec.id,
              documentId: state.doc_id,
              data: { deleted: true },
            }),
          );
        } catch (err) {
          if (errCode(err) !== NOT_FOUND) throw err;
          log.debug(`  ${spec.id}/${recordKey} already gone remotely`);
        }
        store.dropState(localTable, recordKey);
        totals.softDeleted++;
        log.ok(`  - ${spec.id}/${recordKey} (deleted)`);
        continue;
      }

      const record = byKey.get(recordKey);
      if (!record) {
        // refreshDirty should have turned this into a deletion; be defensive.
        log.warn(`  ${spec.id}/${recordKey} pending but missing locally — skipping`);
        continue;
      }

      if (DRY_RUN) {
        log.info(`  [dry-run] would push ${spec.id}/${recordKey}`);
        continue;
      }

      const data = {
        ...spec.sync.toRemote(record),
        sync_scope: cfg.scope,
        local_key: recordKey,
        deleted: false,
      };
      const doc = await withRetry(`upsert ${spec.id}/${recordKey}`, () =>
        databases.upsertDocument({
          databaseId: cfg.databaseId,
          collectionId: spec.id,
          documentId: state.doc_id,
          data,
        }),
      );

      for (const child of children) {
        await pushChildren(ctx, child, recordKey, record[child.field] ?? []);
      }

      store.upsertState({
        tableName: localTable,
        recordKey,
        docId: doc.$id,
        hash: hashRecord(project(record)),
        synced: 1,
        deleted: 0,
        remoteUpdatedAt: doc.$updatedAt,
      });
      totals.pushed++;
      log.ok(`  ↑ ${spec.id}/${recordKey}`);
    } catch (err) {
      totals.failed++;
      log.error(`  ${spec.id}/${recordKey}: ${err?.message ?? err}`);
    }
  }
}

// ── PULL ─────────────────────────────────────────────────────────────────────

/**
 * Returns the parent keys whose documents (or child rows) changed since the
 * stored cursor, and advances each cursor. Child collections are watched
 * separately: editing only a PO's rows never moves the parent's $updatedAt.
 */
async function changedParents(ctx, spec) {
  const { store, databases, cfg } = ctx;
  const { children = [] } = spec.sync;
  const touched = new Map(); // parent key -> latest doc seen (null when only a child changed)
  const cursors = [];

  const parentCursor = store.getMeta(`pull:${spec.id}`) ?? EPOCH;
  const parentDocs = await listAll(
    databases,
    cfg.databaseId,
    spec.id,
    [
      Query.equal("sync_scope", cfg.scope),
      Query.greaterThan("$updatedAt", parentCursor),
      Query.orderAsc("$updatedAt"),
    ],
    "pull",
  );
  for (const doc of parentDocs) touched.set(doc.local_key, doc);
  cursors.push([`pull:${spec.id}`, parentDocs.at(-1)?.$updatedAt]);

  for (const child of children) {
    const childCursor = store.getMeta(`pull:${child.collection}`) ?? EPOCH;
    const childDocs = await listAll(
      databases,
      cfg.databaseId,
      child.collection,
      [
        Query.equal("sync_scope", cfg.scope),
        Query.greaterThan("$updatedAt", childCursor),
        Query.orderAsc("$updatedAt"),
      ],
      "pull",
    );
    for (const doc of childDocs) {
      const parentKey = doc[parentField(child)];
      if (!touched.has(parentKey)) touched.set(parentKey, null);
    }
    cursors.push([`pull:${child.collection}`, childDocs.at(-1)?.$updatedAt]);
  }

  return { touched, cursors };
}

/** Fetches full child rows for the given parent keys, grouped by parent. */
async function fetchChildren(ctx, child, parentKeys) {
  const { databases, cfg } = ctx;
  const field = parentField(child);
  const grouped = new Map(parentKeys.map((k) => [k, []]));

  for (const batch of chunk(parentKeys, 25)) {
    const docs = await listAll(
      databases,
      cfg.databaseId,
      child.collection,
      [Query.equal("sync_scope", cfg.scope), Query.equal(field, batch), Query.orderAsc("line_no")],
      "list children",
    );
    for (const doc of docs) {
      if (doc.deleted) continue;
      grouped.get(doc[field])?.push(doc);
    }
  }

  for (const rows of grouped.values()) rows.sort((a, b) => a.line_no - b.line_no);
  return grouped;
}

async function pullCollection(ctx, spec) {
  const { store, cfg } = ctx;
  const { localTable, key: keyField, children = [], fromRemote } = spec.sync;
  const project = projector(spec);

  const { touched, cursors } = await changedParents(ctx, spec);
  if (touched.size === 0) {
    log.info(`${spec.id}: nothing new to pull`);
    return;
  }
  log.step(`${spec.id}: ${touched.size} remote change(s)`);

  // Parents whose row-set changed but whose header did not still need their
  // current document to rebuild the local record.
  const missingParents = [...touched].filter(([, doc]) => doc === null).map(([key]) => key);
  if (missingParents.length > 0) {
    for (const batch of chunk(missingParents, 25)) {
      const docs = await listAll(
        ctx.databases,
        cfg.databaseId,
        spec.id,
        [Query.equal("sync_scope", cfg.scope), Query.equal("local_key", batch)],
        "pull parents",
      );
      for (const doc of docs) touched.set(doc.local_key, doc);
    }
  }

  const liveKeys = [...touched].filter(([, doc]) => doc && !doc.deleted).map(([key]) => key);
  const childRows = new Map();
  for (const child of children) {
    childRows.set(child.collection, await fetchChildren(ctx, child, liveKeys));
  }

  if (DRY_RUN) {
    for (const [key, doc] of touched) {
      log.info(`  [dry-run] would ${!doc || doc.deleted ? "remove" : "apply"} ${spec.id}/${key}`);
    }
    return;
  }

  const local = store.readTable(localTable);
  const index = new Map();
  local.forEach((r, i) => {
    if (r?.[keyField] != null) index.set(String(r[keyField]), i);
  });

  let applied = 0;
  let removed = 0;
  let failures = 0;
  const pendingState = [];

  for (const [key, doc] of touched) {
    try {
      if (!doc) {
        log.warn(
          `  ${spec.id}/${key}: referenced by a child row but the parent is gone — skipping`,
        );
        continue;
      }

      if (doc.deleted) {
        const at = index.get(key);
        if (at !== undefined) {
          local[at] = null; // compacted below so the remaining indexes stay valid
          index.delete(key);
          removed++;
        }
        pendingState.push({ tableName: localTable, recordKey: key, drop: true });
        log.ok(`  ↓ ${spec.id}/${key} (deleted remotely)`);
        continue;
      }

      const record = fromRemote(doc);
      for (const child of children) {
        const rows = childRows.get(child.collection)?.get(key) ?? [];
        record[child.field] = rows.map((r) => child.fromRemote(r));
      }

      const state = store.getState(localTable, key);
      const hash = hashRecord(project(record));
      if (state?.hash === hash && state.synced === 1) {
        // We wrote this ourselves during the push phase — nothing to apply.
        pendingState.push({
          tableName: localTable,
          recordKey: key,
          docId: doc.$id,
          hash,
          synced: 1,
          remoteUpdatedAt: doc.$updatedAt,
        });
        continue;
      }

      const at = index.get(key);
      if (at === undefined) {
        index.set(key, local.length);
        local.push(record);
      } else {
        local[at] = record;
      }
      applied++;
      pendingState.push({
        tableName: localTable,
        recordKey: key,
        docId: doc.$id,
        hash,
        synced: 1,
        remoteUpdatedAt: doc.$updatedAt,
      });
      log.ok(`  ↓ ${spec.id}/${key}`);
    } catch (err) {
      failures++;
      totals.failed++;
      log.error(`  ${spec.id}/${key}: ${err?.message ?? err}`);
    }
  }

  // One transaction: a blob rewritten without its matching sync state would
  // make every record look dirty on the next run.
  store.transaction(() => {
    store.writeTable(
      localTable,
      local.filter((r) => r !== null),
    );
    for (const s of pendingState) {
      if (s.drop) store.dropState(s.tableName, s.recordKey);
      else store.upsertState({ ...s, deleted: 0 });
    }
    // Only advance the cursor when the whole batch landed. Advancing past a
    // record that failed to apply would drop that change permanently; leaving
    // the cursor put means the next run sees it again.
    if (failures === 0) {
      for (const [metaKey, value] of cursors) {
        if (value) store.setMeta(metaKey, value);
      }
    } else {
      log.warn(`${spec.id}: ${failures} record(s) failed — pull cursor left in place for a retry`);
    }
  });

  totals.pulled += applied;
  totals.removed += removed;
  log.info(`${spec.id}: applied ${applied}, removed ${removed}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Do this before anything else: on a plain-Node runtime whose ABI does not
  // match the installed better-sqlite3 binary, the process re-execs itself
  // under Electron's Node and never returns from here.
  const sqlite = loadSqlite();
  if (!sqlite.ok) {
    if (sqlite.abiMismatch) relaunchUnderElectron();
    log.error(`cannot load better-sqlite3: ${sqlite.reason}`);
    if (sqlite.abiMismatch) log.info(ABI_HELP);
    process.exit(1);
  }

  const { databases, cfg } = makeClient();
  const sqlitePath = cfg.sqlitePath ?? defaultSqlitePath();

  log.section("ERP ⇄ Appwrite sync");
  log.info(`endpoint : ${cfg.endpoint}`);
  log.info(`database : ${cfg.databaseId}`);
  log.info(`sqlite   : ${sqlitePath}`);
  log.info(`scope    : ${cfg.scope}`);
  log.info(
    `mode     : ${DO_PUSH ? "push" : ""}${DO_PUSH && DO_PULL ? " + " : ""}${DO_PULL ? "pull" : ""}`,
  );
  if (DRY_RUN) log.warn("dry-run: nothing will be written on either side");

  const specs = SYNCED.filter((s) => !only || only.has(s.id) || only.has(s.sync.localTable));
  if (specs.length === 0) {
    throw new Error(
      `--table matched no synced collection. Available: ${SYNCED.map((s) => s.id).join(", ")}`,
    );
  }

  let store;
  try {
    store = new LocalStore(sqlitePath, cfg.scope, sqlite.Database);
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }

  const ctx = { store, databases, cfg };
  try {
    if (DO_PUSH) {
      log.section("PUSH  local → Appwrite");
      for (const spec of specs) {
        try {
          await pushCollection(ctx, spec);
        } catch (err) {
          totals.failed++;
          log.error(`push ${spec.id}: ${err?.message ?? err}`);
        }
      }
    }

    if (DO_PULL) {
      log.section("PULL  Appwrite → local");
      for (const spec of specs) {
        try {
          await pullCollection(ctx, spec);
        } catch (err) {
          totals.failed++;
          log.error(`pull ${spec.id}: ${err?.message ?? err}`);
        }
      }
    }
  } finally {
    store.close();
  }

  log.section("Summary");
  log.info(
    `pushed ${totals.pushed}  soft-deleted ${totals.softDeleted}  pulled ${totals.pulled}  removed ${totals.removed}  failed ${totals.failed}`,
  );
  if (totals.failed > 0) {
    log.warn("some records failed — they stay marked unsynced and retry on the next run");
    process.exitCode = 1;
  } else {
    log.ok("sync complete");
  }
}

main().catch((err) => {
  log.error(err?.message ?? err);
  if (process.env.APPWRITE_DEBUG) log.error(err);
  process.exit(1);
});
