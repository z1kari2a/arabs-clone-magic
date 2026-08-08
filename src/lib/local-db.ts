// Local persistence layer.
// Works in the browser (localStorage) and in Electron (via window.erpNative IPC bridge).
// This is the ONLY module that touches raw storage; everything else calls into it.

import type { Supplier, Item, PurchaseOrder, PurchaseRequest, Settings, AuditEntry } from "./erp-types";

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
  randomSalt: () => Promise<string>;
  backupTo: (destPath: string) => Promise<void>;
  restoreFrom: (srcPath: string) => Promise<void>;
  /** Only implemented by the shell build's preload (electron/shell-preload.cjs). */
  backupNow?: () => Promise<string | null>;
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
  } catch { currentScope = null; }
}

export function setCurrentScope(userId: string | null) {
  currentScope = userId;
  if (!isBrowser) return;
  try {
    if (userId) window.sessionStorage.setItem(SCOPE_STORAGE_KEY, userId);
    else window.sessionStorage.removeItem(SCOPE_STORAGE_KEY);
  } catch { /* ignore */ }
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
  window.localStorage.setItem(KEY(table), JSON.stringify(rows));
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
  window.localStorage.setItem(KV_KEY(key), JSON.stringify(value));
}

// ---------- Password hashing ----------
// Electron uses bcrypt via IPC. Browser fallback uses SHA-256(salt+password),
// which is fine for a local single-user desktop app but the Electron build is authoritative.
export async function randomSalt(): Promise<string> {
  const n = native();
  if (n) return n.randomSalt();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const n = native();
  if (n) return n.hashPassword(password, salt);
  const enc = new TextEncoder().encode(salt + ":" + password);
  // crypto.subtle only exists in secure contexts (HTTPS or localhost). This
  // app is often opened over plain http://<lan-ip>, so fall back to a pure-JS
  // SHA-256 there instead of leaving hashPassword() permanently rejected.
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return sha256Hex(enc);
}

// ---------- Pure-JS SHA-256 fallback (insecure contexts) ----------
function sha256Hex(data: Uint8Array): string {
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
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = data.length * 8;
  const padLen = (((data.length + 9 + 63) >> 6) << 6);
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
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => (n >>> 0).toString(16).padStart(8, "0"))
    .join("");
}
function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

// ---------- Audit log ----------
const AUDIT_TABLE = "audit_log";
const AUDIT_MAX = 5000;

export async function logAudit(entry: {
  user_email: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  table_name: string;
  record_id: string | null;
  before_data: unknown;
  after_data: unknown;
}): Promise<void> {
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