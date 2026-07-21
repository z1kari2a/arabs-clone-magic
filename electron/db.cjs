// SQLite persistence layer used by the Electron main process.
// Data model: a generic key/value table stores each "logical table" as one JSON blob.
// This mirrors the browser localStorage shape used by the renderer's local-db.ts,
// so both environments behave identically.

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs"); // pure-JS bcrypt, no native rebuild needed
const crypto = require("crypto");

let db = null;
let currentPath = null;

function init(filePath) {
  currentPath = filePath;
  db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS erp_tables (
      name TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS erp_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function close() {
  if (db) db.close();
  db = null;
}

function dbPath() {
  return currentPath;
}

function getAll(table) {
  const row = db.prepare("SELECT payload FROM erp_tables WHERE name = ?").get(table);
  return row ? JSON.parse(row.payload) : [];
}

function setAll(table, rows) {
  const payload = JSON.stringify(rows ?? []);
  db.prepare(
    "INSERT INTO erp_tables(name, payload) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET payload = excluded.payload",
  ).run(table, payload);
}

function getKV(key) {
  const row = db.prepare("SELECT value FROM erp_kv WHERE key = ?").get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

function setKV(key, value) {
  const v = JSON.stringify(value);
  db.prepare(
    "INSERT INTO erp_kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, v);
}

// bcrypt: salt is embedded in the hash, so we treat the input salt as extra
// keying material (mixed into the password) — the resulting hash is stored.
async function hashPassword(password, salt) {
  return bcrypt.hash(salt + ":" + password, 10);
}

function randomSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function backup(dest) {
  const fs = require("fs");
  fs.copyFileSync(currentPath, dest);
}
function restore(src) {
  const fs = require("fs");
  close();
  fs.copyFileSync(src, currentPath);
  init(currentPath);
}

module.exports = {
  init,
  close,
  dbPath,
  getAll,
  setAll,
  getKV,
  setKV,
  hashPassword,
  randomSalt,
  backup,
  restore,
};