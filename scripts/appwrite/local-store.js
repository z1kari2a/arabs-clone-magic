// Local SQLite side of the sync.
//
// electron/db.cjs stores each logical table as ONE JSON array blob in
// `erp_tables(name, payload)`, so there is no per-row `synced` column to read.
// This module adds that row-level bookkeeping alongside it, without touching
// the blobs the app itself reads:
//
//   erp_sync_state  one row per (scope, table, record) — content hash, the
//                   Appwrite document id, and `synced` (0 = needs pushing)
//   erp_sync_meta   key/value cursors, e.g. the last $updatedAt pulled
//
// `synced = 0` is derived: a record whose current hash differs from the hash
// Appwrite last confirmed is dirty, and so is one that vanished locally
// (tracked as a pending soft delete).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** Where Electron keeps erp.db (see electron/main.cjs). productName is "ERP". */
export function defaultSqlitePath() {
  const home = homedir();
  const candidates =
    platform() === "win32"
      ? [join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "ERP", "erp.db")]
      : platform() === "darwin"
        ? [join(home, "Library", "Application Support", "ERP", "erp.db")]
        : [join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "ERP", "erp.db")];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/** Stable JSON so key order never changes a record's hash. */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function hashRecord(value) {
  return createHash("sha1").update(stableStringify(value)).digest("hex");
}

/**
 * Deterministic Appwrite document id derived from the natural key, so pushing
 * the same record twice updates one document instead of creating duplicates.
 * Appwrite ids allow [a-z A-Z 0-9 . _ -], max 36 chars, no leading special char.
 */
export function docIdFor(scope, collectionId, naturalKey) {
  return createHash("sha1")
    .update(`${scope}|${collectionId}|${naturalKey}`)
    .digest("hex")
    .slice(0, 32);
}

export class LocalStore {
  /**
   * @param {string} filePath  path to erp.db
   * @param {string} scope     tenant/device namespace
   * @param {any} Database     the better-sqlite3 constructor (injected — see sqlite.js
   *                           for why it is not imported statically)
   */
  constructor(filePath, scope, Database) {
    if (!existsSync(filePath)) {
      throw new Error(
        `SQLite database not found at ${filePath}\n` +
          `Run the desktop app once to create it, or set APPWRITE_SQLITE_PATH in .env.appwrite.`,
      );
    }
    this.path = filePath;
    this.scope = scope;
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.#ensureTables();
  }

  #ensureTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS erp_tables (
        name TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS erp_sync_state (
        scope             TEXT NOT NULL,
        table_name        TEXT NOT NULL,
        record_key        TEXT NOT NULL,
        doc_id            TEXT NOT NULL,
        hash              TEXT NOT NULL DEFAULT '',
        synced            INTEGER NOT NULL DEFAULT 0,
        deleted           INTEGER NOT NULL DEFAULT 0,
        remote_updated_at TEXT,
        local_updated_at  TEXT NOT NULL,
        PRIMARY KEY (scope, table_name, record_key)
      );
      CREATE INDEX IF NOT EXISTS idx_sync_state_pending
        ON erp_sync_state(scope, table_name, synced);
      CREATE TABLE IF NOT EXISTS erp_sync_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  // ── Logical tables (the JSON blobs the app reads) ──────────────────────────

  readTable(name) {
    const row = this.db.prepare("SELECT payload FROM erp_tables WHERE name = ?").get(name);
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.payload);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      throw new Error(`erp_tables."${name}" holds invalid JSON: ${err.message}`);
    }
  }

  writeTable(name, rows) {
    this.db
      .prepare(
        "INSERT INTO erp_tables(name, payload) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET payload = excluded.payload",
      )
      .run(name, JSON.stringify(rows ?? []));
  }

  /** Runs `fn` inside a transaction — a half-applied pull would corrupt a blob. */
  transaction(fn) {
    return this.db.transaction(fn)();
  }

  // ── Sync state ────────────────────────────────────────────────────────────

  getState(tableName, recordKey) {
    return this.db
      .prepare("SELECT * FROM erp_sync_state WHERE scope = ? AND table_name = ? AND record_key = ?")
      .get(this.scope, tableName, String(recordKey));
  }

  allStates(tableName) {
    return this.db
      .prepare("SELECT * FROM erp_sync_state WHERE scope = ? AND table_name = ?")
      .all(this.scope, tableName);
  }

  pendingStates(tableName) {
    return this.db
      .prepare("SELECT * FROM erp_sync_state WHERE scope = ? AND table_name = ? AND synced = 0")
      .all(this.scope, tableName);
  }

  upsertState({ tableName, recordKey, docId, hash, synced, deleted = 0, remoteUpdatedAt = null }) {
    this.db
      .prepare(
        `INSERT INTO erp_sync_state
           (scope, table_name, record_key, doc_id, hash, synced, deleted, remote_updated_at, local_updated_at)
         VALUES (@scope, @tableName, @recordKey, @docId, @hash, @synced, @deleted, @remoteUpdatedAt, @now)
         ON CONFLICT(scope, table_name, record_key) DO UPDATE SET
           doc_id            = excluded.doc_id,
           hash              = excluded.hash,
           synced            = excluded.synced,
           deleted           = excluded.deleted,
           remote_updated_at = COALESCE(excluded.remote_updated_at, erp_sync_state.remote_updated_at),
           local_updated_at  = excluded.local_updated_at`,
      )
      .run({
        scope: this.scope,
        tableName,
        recordKey: String(recordKey),
        docId,
        hash,
        synced: synced ? 1 : 0,
        deleted: deleted ? 1 : 0,
        remoteUpdatedAt,
        now: new Date().toISOString(),
      });
  }

  dropState(tableName, recordKey) {
    this.db
      .prepare("DELETE FROM erp_sync_state WHERE scope = ? AND table_name = ? AND record_key = ?")
      .run(this.scope, tableName, String(recordKey));
  }

  getMeta(key) {
    const row = this.db
      .prepare("SELECT value FROM erp_sync_meta WHERE key = ?")
      .get(`${this.scope}:${key}`);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.db
      .prepare(
        "INSERT INTO erp_sync_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(`${this.scope}:${key}`, String(value));
  }

  /**
   * Recomputes `synced` for one logical table by diffing current content
   * against the last-confirmed hash. This is what turns a blob store into
   * something with a meaningful "unsynced rows" query.
   *
   * `project` must produce the full remote projection INCLUDING nested child
   * rows, or an edit confined to a PO's rows would leave the parent hash
   * unchanged and never sync.
   *
   * @returns {{dirty: Array<{key:string, record:object}>, deletions: Array<object>}}
   */
  refreshDirty(tableName, records, keyField, project, collectionId) {
    const seen = new Set();
    const dirty = [];

    for (const record of records) {
      const rawKey = record?.[keyField];
      if (rawKey === undefined || rawKey === null || rawKey === "") continue;
      const key = String(rawKey);
      seen.add(key);

      // Hash the REMOTE projection, not the raw record: local-only fields the
      // schema drops must not make a record look dirty forever.
      const hash = hashRecord(project(record));
      const state = this.getState(tableName, key);

      if (state && state.hash === hash && state.synced === 1 && state.deleted === 0) continue;

      this.upsertState({
        tableName,
        recordKey: key,
        docId: state?.doc_id ?? docIdFor(this.scope, collectionId, key),
        hash,
        synced: 0,
        deleted: 0,
        remoteUpdatedAt: state?.remote_updated_at ?? null,
      });
      dirty.push({ key, record });
    }

    // Anything tracked but no longer in the blob was deleted locally.
    const deletions = this.allStates(tableName).filter(
      (s) => !seen.has(s.record_key) && s.deleted === 0,
    );
    for (const state of deletions) {
      this.upsertState({
        tableName,
        recordKey: state.record_key,
        docId: state.doc_id,
        hash: state.hash,
        synced: 0,
        deleted: 1,
        remoteUpdatedAt: state.remote_updated_at,
      });
    }

    return { dirty, deletions };
  }
}
