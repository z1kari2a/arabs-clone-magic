// Local persistence for the Electron main process — the installed program's
// database. It is created on first launch under the user's data folder
// (%APPDATA%\erp on Windows) and never needs a network connection.
//
// Data model:
//   erp_tables  one JSON blob per logical table (mirrors the browser's
//               localStorage shape in src/lib/local-db.ts, so a database moves
//               between the web and desktop builds unchanged)
//   erp_kv      single values (settings, system_config)
//   erp_audit   one ROW per audit entry — deliberately not a blob: the audit
//               log holds full before/after snapshots of purchase orders, and
//               rewriting the whole history on every edit is what used to make
//               the app freeze while typing.
//
// Nothing here throws at the caller. A desktop app that cannot open its
// database must still start and still let the user work, so if the native
// SQLite module is unusable on the machine (ABI mismatch, missing VC++
// runtime, antivirus quarantine) the same API is served from a plain JSON file
// instead. `status()` reports which backend is live so the UI can say so.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs"); // pure-JS bcrypt, no native rebuild needed

const AUDIT_KEEP = 2000;

let backend = null;
let currentPath = null;
let initError = null;

// ------------------------------------------------------------------ SQLite

function openSqlite(filePath) {
  const Database = require("better-sqlite3");
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  // A power cut mid-write must not corrupt the file; NORMAL is the documented
  // safe pairing with WAL and avoids an fsync on every single commit.
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS erp_tables (
      name TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS erp_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS erp_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      user_email TEXT,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT,
      before_data TEXT,
      after_data TEXT
    );
  `);
  // Reading the file is what proves it is a usable database rather than a
  // truncated or foreign file that merely opened.
  db.prepare("SELECT count(*) AS n FROM erp_tables").get();

  const api = {
    kind: "sqlite",
    getAll(table) {
      const row = db.prepare("SELECT payload FROM erp_tables WHERE name = ?").get(table);
      return row ? parseJson(row.payload, []) : [];
    },
    setAll(table, rows) {
      db.prepare(
        "INSERT INTO erp_tables(name, payload) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET payload = excluded.payload",
      ).run(table, JSON.stringify(rows ?? []));
    },
    getKV(key) {
      const row = db.prepare("SELECT value FROM erp_kv WHERE key = ?").get(key);
      return row ? parseJson(row.value, null) : null;
    },
    setKV(key, value) {
      db.prepare(
        "INSERT INTO erp_kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, JSON.stringify(value ?? null));
    },
    appendAudit(entry) {
      const info = db
        .prepare(
          `INSERT INTO erp_audit(created_at, user_email, action, table_name, record_id, before_data, after_data)
           VALUES(?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.created_at,
          entry.user_email ?? null,
          entry.action,
          entry.table_name,
          entry.record_id ?? null,
          JSON.stringify(entry.before_data ?? null),
          JSON.stringify(entry.after_data ?? null),
        );
      db.prepare("DELETE FROM erp_audit WHERE id <= (SELECT max(id) FROM erp_audit) - ?").run(
        AUDIT_KEEP,
      );
      return Number(info.lastInsertRowid);
    },
    getAudit(limit) {
      return db
        .prepare("SELECT * FROM erp_audit ORDER BY id DESC LIMIT ?")
        .all(Math.min(limit || AUDIT_KEEP, AUDIT_KEEP))
        .map((r) => ({
          id: r.id,
          created_at: r.created_at,
          user_email: r.user_email,
          action: r.action,
          table_name: r.table_name,
          record_id: r.record_id,
          before_data: parseJson(r.before_data, null),
          after_data: parseJson(r.after_data, null),
        }));
    },
    flush() {
      db.pragma("wal_checkpoint(TRUNCATE)");
    },
    close() {
      db.close();
    },
  };

  migrateAuditBlob(api);
  return api;
}

// Databases written before erp_audit existed keep the whole log as one blob in
// erp_tables. Move it across once, so upgrading an installed copy does not lose
// the history and does not keep paying the blob-rewrite cost.
function migrateAuditBlob(api) {
  const legacy = api.getAll("audit_log");
  if (!Array.isArray(legacy) || legacy.length === 0) return;
  for (const e of legacy.slice(0, AUDIT_KEEP).reverse()) {
    api.appendAudit({
      created_at: e.created_at ?? new Date().toISOString(),
      user_email: e.user_email ?? null,
      action: e.action ?? "UPDATE",
      table_name: e.table_name ?? "unknown",
      record_id: e.record_id ?? null,
      before_data: e.before_data ?? null,
      after_data: e.after_data ?? null,
    });
  }
  api.setAll("audit_log", []);
}

// -------------------------------------------------------------- JSON fallback

// Same contract, one file, no native code. Writes go through a temp file and a
// rename so an interrupted save can never leave a half-written database.
function openJson(filePath) {
  const jsonPath = filePath.replace(/\.db$/i, "") + ".json";
  let data = { tables: {}, kv: {}, audit: [], nextAuditId: 1 };
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (parsed && typeof parsed === "object") data = { ...data, ...parsed };
  } catch {
    /* first run, or a file we cannot read — start from an empty database */
  }

  let writeTimer = null;
  const flush = () => {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    const tmp = jsonPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, jsonPath);
  };
  // Coalesce bursts of writes (a bulk import fires hundreds) into one save.
  const save = () => {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      try {
        flush();
      } catch (err) {
        console.error("json store write failed", err);
      }
    }, 200);
  };

  return {
    kind: "json",
    jsonPath,
    getAll: (table) => (Array.isArray(data.tables[table]) ? data.tables[table] : []),
    setAll(table, rows) {
      data.tables[table] = rows ?? [];
      save();
    },
    getKV: (key) => (key in data.kv ? data.kv[key] : null),
    setKV(key, value) {
      data.kv[key] = value ?? null;
      save();
    },
    appendAudit(entry) {
      const id = data.nextAuditId++;
      data.audit.unshift({ id, ...entry });
      if (data.audit.length > AUDIT_KEEP) data.audit.length = AUDIT_KEEP;
      save();
      return id;
    },
    getAudit: (limit) => data.audit.slice(0, Math.min(limit || AUDIT_KEEP, AUDIT_KEEP)),
    flush,
    close: flush,
  };
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// --------------------------------------------------------------------- init

/**
 * Opens (creating it if needed) the database at `filePath`.
 * Never throws — returns which backend came up and why, so the caller can
 * tell the user instead of dying before a window ever appears.
 */
function init(filePath) {
  currentPath = filePath;
  initError = null;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (err) {
    initError = err;
  }

  try {
    backend = openSqlite(filePath);
    return status();
  } catch (err) {
    initError = err;
  }

  // A corrupt or foreign file is the one failure we can fix ourselves: move it
  // aside (never delete — it may be the company's only copy) and start clean.
  if (fs.existsSync(filePath)) {
    try {
      const aside = `${filePath}.corrupt-${Date.now()}`;
      fs.renameSync(filePath, aside);
      for (const suffix of ["-wal", "-shm"]) {
        if (fs.existsSync(filePath + suffix)) fs.rmSync(filePath + suffix, { force: true });
      }
      backend = openSqlite(filePath);
      initError = new Error(
        `تعذّر قراءة قاعدة البيانات، وتم إنشاء واحدة جديدة. النسخة القديمة: ${aside}`,
      );
      return status();
    } catch (err) {
      initError = err;
    }
  }

  try {
    backend = openJson(filePath);
    return status();
  } catch (err) {
    initError = err;
    backend = null;
    return status();
  }
}

function status() {
  return {
    backend: backend?.kind ?? "none",
    path: backend?.kind === "json" ? backend.jsonPath : currentPath,
    error: initError ? String(initError.message ?? initError) : null,
  };
}

function ready() {
  return backend !== null;
}

function close() {
  try {
    backend?.close();
  } catch (err) {
    console.error("db close failed", err);
  }
  backend = null;
}

function dbPath() {
  return status().path;
}

// ------------------------------------------------------------------ accessors

// Reads degrade to "empty" and writes to "not saved" rather than rejecting into
// the renderer, where an unhandled rejection blanks the screen mid-edit.
function getAll(table) {
  if (!backend) return [];
  try {
    return backend.getAll(table);
  } catch (err) {
    console.error(`getAll(${table}) failed`, err);
    return [];
  }
}

function setAll(table, rows) {
  if (!backend) return false;
  try {
    backend.setAll(table, rows);
    return true;
  } catch (err) {
    console.error(`setAll(${table}) failed`, err);
    return false;
  }
}

function getKV(key) {
  if (!backend) return null;
  try {
    return backend.getKV(key);
  } catch (err) {
    console.error(`getKV(${key}) failed`, err);
    return null;
  }
}

function setKV(key, value) {
  if (!backend) return false;
  try {
    backend.setKV(key, value);
    return true;
  } catch (err) {
    console.error(`setKV(${key}) failed`, err);
    return false;
  }
}

function appendAudit(entry) {
  if (!backend) return null;
  try {
    return backend.appendAudit({ created_at: new Date().toISOString(), ...entry });
  } catch (err) {
    console.error("appendAudit failed", err);
    return null;
  }
}

function getAudit(limit) {
  if (!backend) return [];
  try {
    return backend.getAudit(limit);
  } catch (err) {
    console.error("getAudit failed", err);
    return [];
  }
}

// ------------------------------------------------------------------ passwords

// 12 is the current common floor; 10 dates from when it was. Each step doubles
// the work for both the login and an offline cracker — measured here, a verify
// went from ~85ms to ~340ms, which no one notices once per sign-in.
// Raising it is safe at any time: a bcrypt hash carries the cost it was written
// with, so hashes already stored keep verifying with their own value.
const BCRYPT_ROUNDS = 12;

/** bcrypt embeds its own salt, so the caller's salt is extra keying material. */
async function hashPassword(password, salt) {
  return bcrypt.hash(`${salt}:${password}`, BCRYPT_ROUNDS);
}

/**
 * The only correct way to check a password here. A bcrypt hash is different
 * every time it is computed, so comparing a fresh hash against the stored one
 * can never match — doing that is what made every login on Windows fail with
 * "كلمة المرور غير صحيحة".
 *
 * Three formats arrive here, because a database can be created by one build and
 * restored into another:
 *
 *   $2a$… / $2b$…                bcrypt, written by this file
 *   pbkdf2$sha256$<iters>$<hex>  written by the browser build (local-db.ts)
 *   <64 hex chars>               plain SHA-256, written by older browser builds
 *
 * The iteration count is read out of the hash rather than assumed, so a hash
 * written with a different count still verifies.
 */
async function verifyPassword(password, salt, storedHash) {
  if (typeof storedHash !== "string" || !storedHash) return false;
  if (/^\$2[abxy]?\$/.test(storedHash)) {
    try {
      return await bcrypt.compare(`${salt}:${password}`, storedHash);
    } catch {
      return false;
    }
  }
  if (storedHash.startsWith(PBKDF2_PREFIX)) {
    const [iters, expected] = storedHash.slice(PBKDF2_PREFIX.length).split("$");
    const rounds = Number(iters);
    if (!Number.isInteger(rounds) || rounds < 1 || !expected) return false;
    let derived;
    try {
      derived = await pbkdf2Hex(password, salt, rounds);
    } catch {
      return false;
    }
    return timingSafeEqualHex(derived, expected);
  }
  const sha = crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return timingSafeEqualHex(sha, storedHash);
}

const PBKDF2_PREFIX = "pbkdf2$sha256$";

function pbkdf2Hex(password, salt, iterations) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, "sha256", (err, key) =>
      err ? reject(err) : resolve(key.toString("hex")),
    );
  });
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function randomSalt() {
  return crypto.randomBytes(16).toString("hex");
}

// -------------------------------------------------------------------- backup

function backup(dest) {
  if (!backend) throw new Error("قاعدة البيانات غير مفتوحة");
  // WAL mode keeps recent commits in a separate -wal file; checkpoint first so
  // the file being copied actually contains the latest writes.
  backend.flush();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(dbPath(), dest);
  return dest;
}

function restore(src) {
  const target = dbPath();
  close();
  fs.copyFileSync(src, target);
  // A restored file brings its own contents; leftover WAL/SHM from the replaced
  // database would be applied on top of it.
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(target + suffix)) fs.rmSync(target + suffix, { force: true });
  }
  return init(currentPath);
}

module.exports = {
  init,
  close,
  ready,
  status,
  dbPath,
  getAll,
  setAll,
  getKV,
  setKV,
  appendAudit,
  getAudit,
  hashPassword,
  verifyPassword,
  randomSalt,
  backup,
  restore,
};
