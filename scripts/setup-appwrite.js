#!/usr/bin/env node
// Creates the Appwrite database schema defined in scripts/appwrite/schema.js.
//
//   node scripts/setup-appwrite.js            # create anything missing
//   node scripts/setup-appwrite.js --dry-run  # report the diff, change nothing
//
// Idempotent: run it as often as you like. It only ever ADDS what is missing —
// it never drops or retypes an existing attribute, because that would destroy
// data. Mismatches are reported as warnings for you to resolve by hand.

import { Permission, Role } from "node-appwrite";
import { makeClient, errCode, ALREADY_EXISTS, NOT_FOUND } from "./appwrite/client.js";
import { COLLECTIONS } from "./appwrite/schema.js";
import { log, withRetry, sleep } from "./appwrite/log.js";

const DRY_RUN = process.argv.includes("--dry-run");

// Documents are written only by this script's API key (server-side sync), so
// no client role gets direct access. Widen here if the web app ever talks to
// Appwrite straight from the browser.
const COLLECTION_PERMISSIONS = [
  Permission.read(Role.any()),
  Permission.create(Role.users()),
  Permission.update(Role.users()),
  Permission.delete(Role.users()),
];

const stats = { collections: 0, attributes: 0, indexes: 0, skipped: 0, warnings: 0 };

async function ensureDatabase(databases, databaseId) {
  try {
    const db = await withRetry("databases.get", () => databases.get({ databaseId }));
    log.ok(`database "${db.name}" (${databaseId}) exists`);
    return;
  } catch (err) {
    if (errCode(err) !== NOT_FOUND) throw err;
  }
  if (DRY_RUN) {
    log.info(`[dry-run] would create database ${databaseId}`);
    return;
  }
  await withRetry("databases.create", () =>
    databases.create({ databaseId, name: "ERP", enabled: true }),
  );
  log.ok(`created database ${databaseId}`);
}

async function ensureCollection(databases, databaseId, spec) {
  try {
    await withRetry(`getCollection ${spec.id}`, () =>
      databases.getCollection({ databaseId, collectionId: spec.id }),
    );
    log.debug(`collection ${spec.id} exists`);
    return true;
  } catch (err) {
    if (errCode(err) !== NOT_FOUND) throw err;
  }

  if (DRY_RUN) {
    log.info(`[dry-run] would create collection ${spec.id} (${spec.attributes.length} attributes)`);
    return false;
  }

  try {
    await withRetry(`createCollection ${spec.id}`, () =>
      databases.createCollection({
        databaseId,
        collectionId: spec.id,
        name: spec.name,
        permissions: COLLECTION_PERMISSIONS,
        documentSecurity: false,
        enabled: true,
      }),
    );
    stats.collections++;
    log.ok(`created collection ${spec.id}`);
  } catch (err) {
    // Another run (or another machine) got there first — fine.
    if (errCode(err) !== ALREADY_EXISTS) throw err;
    log.debug(`collection ${spec.id} created concurrently`);
  }
  return true;
}

function createAttribute(databases, databaseId, collectionId, attr) {
  const base = { databaseId, collectionId, key: attr.key, required: attr.required ?? false };
  // Appwrite rejects a default on a required attribute; keep them exclusive.
  const xdefault = base.required ? undefined : attr.xdefault;

  switch (attr.type) {
    case "string":
      return databases.createStringAttribute({ ...base, size: attr.size, xdefault });
    case "integer":
      return databases.createIntegerAttribute({ ...base, xdefault, min: attr.min, max: attr.max });
    case "double":
      return databases.createFloatAttribute({ ...base, xdefault, min: attr.min, max: attr.max });
    case "boolean":
      return databases.createBooleanAttribute({ ...base, xdefault });
    case "datetime":
      return databases.createDatetimeAttribute({ ...base, xdefault });
    case "enum":
      return databases.createEnumAttribute({ ...base, elements: attr.elements, xdefault });
    default:
      throw new Error(`Unknown attribute type "${attr.type}" for ${collectionId}.${attr.key}`);
  }
}

async function ensureAttributes(databases, databaseId, spec) {
  const existing = new Map();
  try {
    const res = await withRetry(`listAttributes ${spec.id}`, () =>
      databases.listAttributes({ databaseId, collectionId: spec.id }),
    );
    for (const a of res.attributes) existing.set(a.key, a);
  } catch (err) {
    if (errCode(err) !== NOT_FOUND) throw err;
  }

  const created = [];
  for (const attr of spec.attributes) {
    const found = existing.get(attr.key);
    if (found) {
      // Never retype in place — that drops data. Report and move on.
      if (attr.type === "string" && found.size != null && found.size < attr.size) {
        log.warn(
          `${spec.id}.${attr.key}: existing size ${found.size} < expected ${attr.size} — widen it manually in the console`,
        );
        stats.warnings++;
      }
      stats.skipped++;
      continue;
    }
    if (DRY_RUN) {
      log.info(`[dry-run] would create ${spec.id}.${attr.key} (${attr.type})`);
      continue;
    }
    try {
      await withRetry(`createAttribute ${spec.id}.${attr.key}`, () =>
        createAttribute(databases, databaseId, spec.id, attr),
      );
      created.push(attr.key);
      stats.attributes++;
      log.ok(`  + ${spec.id}.${attr.key} (${attr.type})`);
    } catch (err) {
      if (errCode(err) === ALREADY_EXISTS) {
        stats.skipped++;
        continue;
      }
      throw new Error(`creating ${spec.id}.${attr.key}: ${err?.message ?? err}`);
    }
    // Appwrite serialises schema changes per collection; a short gap keeps the
    // API from rejecting the next create while this one is still processing.
    await sleep(120);
  }
  return created;
}

/**
 * Attributes are created asynchronously and sit in `processing` for a moment.
 * An index over an attribute that is not yet `available` fails, so wait first.
 */
async function waitForAttributes(databases, databaseId, collectionId, keys, timeoutMs = 90_000) {
  if (keys.length === 0) return;
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(keys);

  while (pending.size > 0) {
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for attributes on ${collectionId}: ${[...pending].join(", ")}`,
      );
    }
    const res = await withRetry(`listAttributes ${collectionId}`, () =>
      databases.listAttributes({ databaseId, collectionId }),
    );
    for (const a of res.attributes) {
      if (!pending.has(a.key)) continue;
      if (a.status === "available") pending.delete(a.key);
      else if (a.status === "failed") {
        throw new Error(
          `attribute ${collectionId}.${a.key} failed to create: ${a.error ?? "unknown"}`,
        );
      }
    }
    if (pending.size > 0) await sleep(700);
  }
  log.debug(`all attributes available on ${collectionId}`);
}

async function ensureIndexes(databases, databaseId, spec) {
  if (!spec.indexes?.length) return;

  const existing = new Set();
  try {
    const res = await withRetry(`listIndexes ${spec.id}`, () =>
      databases.listIndexes({ databaseId, collectionId: spec.id }),
    );
    for (const i of res.indexes) existing.add(i.key);
  } catch (err) {
    if (errCode(err) !== NOT_FOUND) throw err;
  }

  for (const index of spec.indexes) {
    if (existing.has(index.key)) {
      stats.skipped++;
      continue;
    }
    if (DRY_RUN) {
      log.info(`[dry-run] would create index ${spec.id}.${index.key} (${index.type})`);
      continue;
    }
    try {
      await withRetry(`createIndex ${spec.id}.${index.key}`, () =>
        databases.createIndex({
          databaseId,
          collectionId: spec.id,
          key: index.key,
          type: index.type,
          attributes: index.attributes,
        }),
      );
      stats.indexes++;
      log.ok(`  + index ${spec.id}.${index.key} [${index.attributes.join(", ")}] (${index.type})`);
    } catch (err) {
      if (errCode(err) === ALREADY_EXISTS) {
        stats.skipped++;
        continue;
      }
      // A bad index should not abort the whole schema run.
      log.error(`index ${spec.id}.${index.key} failed: ${err?.message ?? err}`);
      stats.warnings++;
    }
    await sleep(120);
  }
}

async function main() {
  const { databases, cfg } = makeClient();

  log.section("Appwrite schema setup");
  log.info(`endpoint : ${cfg.endpoint}`);
  log.info(`project  : ${cfg.projectId}`);
  log.info(`database : ${cfg.databaseId}`);
  if (DRY_RUN) log.warn("dry-run: nothing will be written");

  await ensureDatabase(databases, cfg.databaseId);

  for (const spec of COLLECTIONS) {
    log.step(`collection ${spec.id}`);
    try {
      await ensureCollection(databases, cfg.databaseId, spec);
      const created = await ensureAttributes(databases, cfg.databaseId, spec);
      await waitForAttributes(databases, cfg.databaseId, spec.id, created);
      await ensureIndexes(databases, cfg.databaseId, spec);
    } catch (err) {
      // Keep going: one broken collection should not block the other twelve.
      log.error(`collection ${spec.id}: ${err?.message ?? err}`);
      stats.warnings++;
    }
  }

  log.section("Summary");
  log.info(
    `collections created: ${stats.collections}  attributes: ${stats.attributes}  indexes: ${stats.indexes}  already present: ${stats.skipped}`,
  );
  if (stats.warnings > 0) {
    log.warn(`${stats.warnings} warning(s) — see above`);
    process.exitCode = 1;
  } else {
    log.ok("schema is up to date");
  }
}

main().catch((err) => {
  log.error(err?.message ?? err);
  if (process.env.APPWRITE_DEBUG) log.error(err);
  process.exit(1);
});
