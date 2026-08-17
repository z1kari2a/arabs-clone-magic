// Local persistence layer.
// Works in the browser (localStorage) and in Electron (via window.erpNative IPC bridge).
// This is the ONLY module that touches raw storage; everything else calls into it.

import type {
  Supplier,
  Item,
  PurchaseOrder,
  PurchaseRequest,
  Settings,
  AuditEntry,
} from "./erp-types";

export type LocalUser = {
  id: string;
  username: string; // email or username
  fullName: string;
  role: "admin" | "user" | "viewer";
  active: boolean;
  passwordHash: string;
  salt: string;
  createdAt: string;
  /** Pending admin approval — cannot sign in until an admin approves. */
  pending?: boolean;
};

type NativeBridge = {
  isElectron: true;
  getAll: (table: string) => Promise<any[]>;
  setAll: (table: string, rows: any[]) => Promise<void>;
  getKV: (key: string) => Promise<any>;
  setKV: (key: string, value: any) => Promise<void>;
  hashPassword: (password: string, salt: string) => Promise<string>;
  verifyPassword: (password: string, salt: string, hash: string) => Promise<boolean>;
  randomSalt: () => Promise<string>;
  appendAudit: (entry: Omit<AuditEntry, "id" | "created_at">) => Promise<number | null>;
  getAudit: (limit?: number) => Promise<AuditEntry[]>;
  dbStatus: () => Promise<{ backend: string; path: string; error: string | null }>;
  backupTo: (destPath: string) => Promise<void>;
  restoreFrom: (srcPath: string) => Promise<void>;
  /** Triggers the same automatic backup the timer runs. Optional: an older
   *  installed copy ships a preload without it. */
  backupNow?: () => Promise<string | null>;
  // ---- حوارات وأفعال ويندوز الأصلية ----
  // كانت معروضة في preload.cjs وغائبة عن هذا النوع، فأي خطأ في استعمالها لا
  // يلتقطه مدقّق الأنواع. اختيارية لأن نسخة المتصفح بلا جسر، ولأن نسخة مثبَّتة
  // قديمة قد تحمل preload أقدم لا يعرفها.
  /** حوار تأكيد ويندوز — متزامن. يركّبه src/lib/native-dialogs.ts فوق window.confirm. */
  confirmSync?: (message: string) => boolean;
  /** حوار تنبيه ويندوز — متزامن. */
  alertSync?: (message: string) => void;
  info?: () => Promise<{ version: string; platform: string; dataDir: string }>;
  backupDialog?: () => Promise<boolean>;
  restoreDialog?: () => Promise<boolean>;
  print?: () => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
  /**
   * Renames/re-icons the desktop window. Optional because the browser build has
   * no bridge at all, and an older installed copy has no such handler.
   */
  setBranding?: (branding: { name: string; icon: string | null }) => Promise<boolean>;
  /**
   * Automatic updates. Optional for the same two reasons as setBranding: the
   * browser build has no bridge, and a copy installed before this shipped has
   * an older preload with no `updates` on it.
   */
  updates?: UpdateBridge;
};

/** Mirrors the `state` object in electron/updater.cjs. */
export type UpdateState = {
  phase: "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  currentVersion: string;
  version: string | null;
  notes: string | null;
  percent: number;
  error: string | null;
  checkedAt: number | null;
  auto: boolean;
  /** false outside the installed Windows build — nothing to update there. */
  supported: boolean;
};

type UpdateBridge = {
  state: () => Promise<UpdateState>;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<boolean>;
  setAuto: (auto: boolean) => Promise<UpdateState>;
  /** Returns the unsubscribe function. */
  onState: (callback: (state: UpdateState) => void) => () => void;
};

declare global {
  interface Window {
    erpNative?: NativeBridge;
  }
}

const isBrowser = typeof window !== "undefined";
const native = () => (isBrowser ? window.erpNative : undefined);

// ---------- Per-user scoping ----------
// Tables listed here are stored PER user account, so signing in as a
// different user shows only that user's own data. `users` stays global
// (needed for the login screen itself).
const SCOPED_TABLES = new Set([
  "suppliers",
  "items",
  "purchase_orders",
  "purchase_requests",
  "audit_log",
]);
const SCOPED_KV = new Set(["settings"]);

const SCOPE_STORAGE_KEY = "erp:current-scope";
let currentScope: string | null = null;
if (isBrowser) {
  try {
    currentScope = window.sessionStorage.getItem(SCOPE_STORAGE_KEY);
  } catch {
    currentScope = null;
  }
}

export function setCurrentScope(userId: string | null) {
  currentScope = userId;
  if (!isBrowser) return;
  try {
    if (userId) window.sessionStorage.setItem(SCOPE_STORAGE_KEY, userId);
    else window.sessionStorage.removeItem(SCOPE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function getCurrentScope(): string | null {
  return currentScope;
}

const KEY = (table: string) => {
  if (SCOPED_TABLES.has(table) && currentScope) {
    return `erp:u:${currentScope}:${table}`;
  }
  return `erp:${table}`;
};

const KV_KEY = (key: string) => {
  if (SCOPED_KV.has(key) && currentScope) {
    return `erp:u:${currentScope}:kv:${key}`;
  }
  return `erp:kv:${key}`;
};

// ---------- Web storage writes ----------
// Every write here used to be a bare setItem. localStorage is capped at roughly
// 5 MB per ORIGIN — not per user — so the per-account scoping above means three
// accounts on one browser share that cap. A table array crosses it at around
// 850 purchase orders, and setItem then throws QuotaExceededError.
//
// Unhandled, that rejection surfaced as nothing at all: the write silently did
// not happen and the user kept editing a document that was no longer being
// saved. Losing data quietly is worse than any error message, so writes now go
// through one helper that reports the condition and still throws for callers
// that can react (a draft autosave, for one, should stop retrying).

export class StorageFullError extends Error {
  readonly key: string;
  constructor(key: string, cause?: unknown) {
    super("مساحة التخزين في المتصفح ممتلئة — لم يُحفظ التغيير");
    this.name = "StorageFullError";
    this.key = key;
    this.cause = cause;
  }
}

const storageFullListeners = new Set<(err: StorageFullError) => void>();

/**
 * Registers a listener for "browser storage is full". The app subscribes once at
 * the root so any write path reports it, instead of each call site remembering
 * to catch. Returns the unsubscribe function.
 */
export function onStorageFull(fn: (err: StorageFullError) => void): () => void {
  storageFullListeners.add(fn);
  return () => storageFullListeners.delete(fn);
}

// Browsers disagree on how they signal a full quota: the name is the reliable
// signal in modern ones, code 22 is Safari's older DOMException, and 1014 is
// Firefox's NS_ERROR_DOM_QUOTA_REACHED.
function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as DOMException).code;
  return (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    code === 1014
  );
}

/**
 * The only place this module (or anything else) should write web storage.
 * Serializes, writes, and turns a full quota into a reported, typed error.
 */
export function writeWebStorage(
  key: string,
  value: unknown,
  area: "local" | "session" = "local",
): void {
  if (!isBrowser) return;
  const store = area === "local" ? window.localStorage : window.sessionStorage;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    const full = new StorageFullError(key, err);
    // Listeners must not be able to swallow the throw below, so their own
    // failures are contained here.
    for (const fn of storageFullListeners) {
      try {
        fn(full);
      } catch (listenerErr) {
        console.error("onStorageFull listener failed", listenerErr);
      }
    }
    throw full;
  }
}

// ---------- Generic table storage ----------
export async function getAll<T = any>(table: string): Promise<T[]> {
  const n = native();
  if (n) return (await n.getAll(table)) as T[];
  if (!isBrowser) return [];
  try {
    const raw = window.localStorage.getItem(KEY(table));
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

export async function setAll<T = any>(table: string, rows: T[]): Promise<void> {
  const n = native();
  if (n) return n.setAll(table, rows as any);
  if (!isBrowser) return;
  writeWebStorage(KEY(table), rows);
}

// ---------- Per-table write serialization ----------
// Every mutation below is a read-modify-write over the WHOLE table array. Two of
// them in flight at once both read the same snapshot, and the second write
// erases the first — saving N records persisted only the last one, and a cloud
// restore rebuilt each table with a single row. Mutations now run inside a
// per-table queue so each one's read and write are atomic against the others.
const writeQueues = new Map<string, Promise<unknown>>();

function withTableLock<T>(table: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(table) ?? Promise.resolve();
  // Run `fn` whether the previous operation resolved or rejected — otherwise a
  // single failure would wedge this table's queue for the rest of the session.
  const next = prev.then(fn, fn);
  writeQueues.set(
    table,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function applyUpsert<T extends Record<string, any>>(rows: T[], row: T, key: keyof T): void {
  const idx = rows.findIndex((r) => r[key] === row[key]);
  if (idx >= 0) rows[idx] = row;
  else rows.push(row);
}

export async function upsertBy<T extends Record<string, any>>(
  table: string,
  row: T,
  key: keyof T,
): Promise<void> {
  return withTableLock(table, async () => {
    const rows = await getAll<T>(table);
    applyUpsert(rows, row, key);
    await setAll(table, rows);
  });
}

/**
 * Insert-or-update many rows in ONE read-modify-write pass.
 * Prefer this over looping `upsertBy` — a loop is both N times slower and, if
 * the caller forgets to await each iteration, silently lossy.
 */
export async function upsertManyBy<T extends Record<string, any>>(
  table: string,
  incoming: T[],
  key: keyof T,
): Promise<void> {
  if (!incoming.length) return;
  return withTableLock(table, async () => {
    const rows = await getAll<T>(table);
    for (const row of incoming) applyUpsert(rows, row, key);
    await setAll(table, rows);
  });
}

/** Replace the entire table contents in a single write. */
export async function replaceAll<T>(table: string, rows: T[]): Promise<void> {
  return withTableLock(table, async () => {
    await setAll(table, rows);
  });
}

export async function removeBy<T extends Record<string, any>>(
  table: string,
  key: keyof T,
  value: any,
): Promise<T | undefined> {
  return withTableLock(table, async () => {
    const rows = await getAll<T>(table);
    const idx = rows.findIndex((r) => r[key] === value);
    if (idx < 0) return undefined;
    const [removed] = rows.splice(idx, 1);
    await setAll(table, rows);
    return removed;
  });
}

// ---------- KV (single-value settings) ----------
export async function getKV<T = any>(key: string): Promise<T | null> {
  const n = native();
  const scoped = SCOPED_KV.has(key) && currentScope ? `u:${currentScope}:${key}` : key;
  if (n) return (await n.getKV(scoped)) as T | null;
  if (!isBrowser) return null;
  try {
    const raw = window.localStorage.getItem(KV_KEY(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export async function setKV(key: string, value: any): Promise<void> {
  const n = native();
  const scoped = SCOPED_KV.has(key) && currentScope ? `u:${currentScope}:${key}` : key;
  if (n) return n.setKV(scoped, value);
  if (!isBrowser) return;
  writeWebStorage(KV_KEY(key), value);
}

// ---------- Password hashing ----------
// Electron hashes with bcrypt over IPC and is authoritative. The browser build
// has to do it itself, and there are three stored formats it must understand:
//
//   $2a$… / $2b$…               bcrypt, written by the desktop build
//   pbkdf2$sha256$<iters>$<hex>  written here, current
//   <64 hex chars>               plain SHA-256, written here before this change
//
// The plain SHA-256 form is one hash round, so a leaked database could be
// brute-forced at GPU speed — the whole point of a password hash is to be slow.
// PBKDF2 replaces it. Old hashes still verify (nobody is locked out); they are
// upgraded to PBKDF2 the next time the password is set, and callers can detect
// one with needsRehash() to upgrade at login.
//
// The iteration count is stored inside the hash, not read from a constant here.
// Raising the constant later must not invalidate hashes written before it.
const PBKDF2_PREFIX = "pbkdf2$sha256$";
// crypto.subtle is native, so this is the OWASP figure and costs ~0.2s.
const PBKDF2_ITERATIONS_SUBTLE = 600_000;
// The pure-JS path runs in the interpreter. 600k there would freeze the login
// screen for the better part of a minute, so it gets a lower count — still
// 60,000 times the work of the single round it replaces.
const PBKDF2_ITERATIONS_JS = 60_000;

export async function randomSalt(): Promise<string> {
  const n = native();
  if (n) return n.randomSalt();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Checks a password against a stored hash. Never re-hash and compare instead:
 * the desktop build stores bcrypt hashes, and bcrypt produces a different hash
 * every time it runs, so an equality check against a fresh hash always fails —
 * which is why every login in the Windows build used to be rejected.
 */
export async function verifyPassword(
  password: string,
  salt: string,
  storedHash: string,
): Promise<boolean> {
  if (!storedHash) return false;
  const n = native();
  if (n?.verifyPassword) return n.verifyPassword(password, salt, storedHash);
  if (/^\$2[abxy]?\$/.test(storedHash)) {
    // A bcrypt hash in the browser: the account was created (or restored from a
    // backup taken) on the desktop build. bcryptjs is pure JS, so it verifies
    // here too — it is only imported when such a hash actually turns up.
    const bcrypt = (await import("bcryptjs")).default;
    return bcrypt.compare(salt + ":" + password, storedHash);
  }
  if (storedHash.startsWith(PBKDF2_PREFIX)) {
    const [iters, expected] = storedHash.slice(PBKDF2_PREFIX.length).split("$");
    const rounds = Number(iters);
    if (!Number.isInteger(rounds) || rounds < 1 || !expected) return false;
    return equalsConstantTime(await pbkdf2Hex(password, salt, rounds), expected);
  }
  // Legacy single-round SHA-256. Kept only so existing accounts still log in.
  return equalsConstantTime(await legacySha256Hex(password, salt), storedHash);
}

/**
 * True when the stored hash is in a format weaker than what hashPassword now
 * writes, so the caller can transparently re-hash after a successful login.
 */
export function needsRehash(storedHash: string): boolean {
  if (!storedHash) return false;
  if (/^\$2[abxy]?\$/.test(storedHash)) return false; // bcrypt, desktop-owned
  return !storedHash.startsWith(PBKDF2_PREFIX);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const n = native();
  if (n) return n.hashPassword(password, salt);
  const subtle = hasSubtle();
  const rounds = subtle ? PBKDF2_ITERATIONS_SUBTLE : PBKDF2_ITERATIONS_JS;
  return `${PBKDF2_PREFIX}${rounds}$${await pbkdf2Hex(password, salt, rounds)}`;
}

// crypto.subtle only exists in secure contexts (HTTPS or localhost). This app is
// often opened over plain http://<lan-ip>, so every path needs a pure-JS twin
// rather than being left permanently rejected.
function hasSubtle(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

async function pbkdf2Hex(password: string, salt: string, iterations: number): Promise<string> {
  const pw = new TextEncoder().encode(password);
  const st = new TextEncoder().encode(salt);
  if (hasSubtle()) {
    const key = await crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: st, iterations },
      key,
      256,
    );
    return toHex(new Uint8Array(bits));
  }
  return toHex(pbkdf2Sha256Js(pw, st, iterations));
}

async function legacySha256Hex(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder().encode(salt + ":" + password);
  if (hasSubtle()) return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc)));
  return toHex(sha256Bytes(enc));
}

/** Comparing hashes with === leaks how many leading characters matched. */
function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- Pure-JS SHA-256 fallback (insecure contexts) ----------
// Returns the raw 32 bytes rather than hex: PBKDF2 below needs to feed one
// digest straight into the next, and going through hex each round would mean
// parsing 64 characters back into bytes 60,000 times per login.
function sha256Bytes(data: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a;
  let h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  const bitLen = data.length * 8;
  const padLen = ((data.length + 9 + 63) >> 6) << 6;
  const msg = new Uint8Array(padLen);
  msg.set(data);
  msg[data.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(padLen - 4, bitLen >>> 0);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));

  const w = new Int32Array(64);
  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  // One DataView, not eight: PBKDF2 calls this ~120,000 times per login on the
  // pure-JS path, and each view was an allocation in that loop.
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0 >>> 0);
  outView.setUint32(4, h1 >>> 0);
  outView.setUint32(8, h2 >>> 0);
  outView.setUint32(12, h3 >>> 0);
  outView.setUint32(16, h4 >>> 0);
  outView.setUint32(20, h5 >>> 0);
  outView.setUint32(24, h6 >>> 0);
  outView.setUint32(28, h7 >>> 0);
  return out;
}
function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Pure-JS HMAC-SHA256 and PBKDF2 ----------
// Only reached in an insecure context, where crypto.subtle does not exist.

const BLOCK = 64; // SHA-256 block size

function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  // A key longer than one block is hashed down first; shorter keys are zero
  // padded. Skipping this step is the classic HMAC implementation bug.
  const k = new Uint8Array(BLOCK);
  k.set(key.length > BLOCK ? sha256Bytes(key) : key);

  const inner = new Uint8Array(BLOCK + msg.length);
  const outer = new Uint8Array(BLOCK + 32);
  for (let i = 0; i < BLOCK; i++) {
    inner[i] = k[i] ^ 0x36;
    outer[i] = k[i] ^ 0x5c;
  }
  inner.set(msg, BLOCK);
  outer.set(sha256Bytes(inner), BLOCK);
  return sha256Bytes(outer);
}

/** PBKDF2-HMAC-SHA256, single 32-byte output block (dkLen = hLen, so c = 1). */
function pbkdf2Sha256Js(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array {
  // U1 = PRF(P, S || INT(1))
  const block1 = new Uint8Array(salt.length + 4);
  block1.set(salt);
  block1[salt.length + 3] = 1;

  let u = hmacSha256(password, block1);
  const out = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = hmacSha256(password, u);
    for (let j = 0; j < 32; j++) out[j] ^= u[j];
  }
  return out;
}

// ---------- Audit log ----------
const AUDIT_TABLE = "audit_log";
// Entries carry full before/after snapshots — a purchase order with a hundred
// lines each time. The browser has to rewrite the whole array on every entry,
// so the cap is what bounds the cost of saving anything; the desktop build
// appends a single row and keeps more (see electron/db.cjs).
const AUDIT_MAX = 500;

export async function logAudit(entry: {
  user_email: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  table_name: string;
  record_id: string | null;
  before_data: unknown;
  after_data: unknown;
}): Promise<void> {
  const n = native();
  // One INSERT. The old path read the entire log out of the database, unshifted
  // one entry, and wrote all of it back — through IPC, twice, on every single
  // edit. That is what made saving a large purchase order freeze the window.
  if (n?.appendAudit) {
    await n.appendAudit(entry);
    return;
  }
  // Serialized like every other mutation: concurrent audit writes used to read
  // the same snapshot, hand out the same `id`, and drop all but one entry.
  return withTableLock(AUDIT_TABLE, async () => {
    const rows = await getAll<AuditEntry>(AUDIT_TABLE);
    const nextId = rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1;
    rows.unshift({
      id: nextId,
      created_at: new Date().toISOString(),
      ...entry,
    });
    if (rows.length > AUDIT_MAX) rows.length = AUDIT_MAX;
    await setAll(AUDIT_TABLE, rows);
  });
}

export async function getAudit(): Promise<AuditEntry[]> {
  const n = native();
  if (n?.getAudit) return n.getAudit();
  return getAll<AuditEntry>(AUDIT_TABLE);
}

// ---------- Convenience typed getters ----------
export const localDb = {
  suppliers: {
    list: () => getAll<Supplier>("suppliers"),
    upsert: (s: Supplier) => upsertBy("suppliers", s, "code"),
    upsertMany: (s: Supplier[]) => upsertManyBy("suppliers", s, "code"),
    replaceAll: (s: Supplier[]) => replaceAll("suppliers", s),
    remove: (code: string) => removeBy<Supplier>("suppliers", "code", code),
  },
  items: {
    list: () => getAll<Item>("items"),
    upsert: (i: Item) => upsertBy("items", i, "code"),
    upsertMany: (i: Item[]) => upsertManyBy("items", i, "code"),
    replaceAll: (i: Item[]) => replaceAll("items", i),
    remove: (code: string) => removeBy<Item>("items", "code", code),
  },
  purchaseOrders: {
    list: () => getAll<PurchaseOrder>("purchase_orders"),
    upsert: (p: PurchaseOrder) => upsertBy("purchase_orders", p, "number"),
    upsertMany: (p: PurchaseOrder[]) => upsertManyBy("purchase_orders", p, "number"),
    replaceAll: (p: PurchaseOrder[]) => replaceAll("purchase_orders", p),
    remove: (num: string) => removeBy<PurchaseOrder>("purchase_orders", "number", num),
  },
  // طلبات الشراء — جدول مستقل تماماً عن أوامر الشراء: مستند تقديري قبل الشراء،
  // بلا مصروفات، ولا يجوز أن يختلط بأرقام أوامر الشراء الفعلية.
  purchaseRequests: {
    list: () => getAll<PurchaseRequest>("purchase_requests"),
    upsert: (p: PurchaseRequest) => upsertBy("purchase_requests", p, "number"),
    upsertMany: (p: PurchaseRequest[]) => upsertManyBy("purchase_requests", p, "number"),
    replaceAll: (p: PurchaseRequest[]) => replaceAll("purchase_requests", p),
    remove: (num: string) => removeBy<PurchaseRequest>("purchase_requests", "number", num),
  },
  users: {
    list: () => getAll<LocalUser>("users"),
    upsert: (u: LocalUser) => upsertBy("users", u, "id"),
    upsertMany: (u: LocalUser[]) => upsertManyBy("users", u, "id"),
    replaceAll: (u: LocalUser[]) => replaceAll("users", u),
    remove: (id: string) => removeBy<LocalUser>("users", "id", id),
  },
  settings: {
    get: (): Promise<Settings | null> => getKV<Settings>("settings"),
    set: (s: Settings) => setKV("settings", s),
  },
  // Deliberately NOT in SCOPED_KV — like `users`, this must be readable from
  // the login page before anyone is signed in (no scope set yet).
  systemConfig: {
    get: (): Promise<SystemConfig | null> => getKV<SystemConfig>("system_config"),
    set: (c: SystemConfig) => setKV("system_config", c),
  },
};

export type SystemConfig = {
  /** When false, the "إنشاء حساب" tab is hidden on the login page and
   *  self-signup is rejected — only an admin can create new users from
   *  /users. Bootstrap (creating the very first admin) always stays open
   *  regardless of this flag, or the system could lock itself out. */
  allowSignup: boolean;
};

export function newId(): string {
  return "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
