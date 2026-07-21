// Local persistence layer.
// Works in the browser (localStorage) and in Electron (via window.erpNative IPC bridge).
// This is the ONLY module that touches raw storage; everything else calls into it.

import type { Supplier, Item, PurchaseOrder, Settings, AuditEntry } from "./erp-types";

export type LocalUser = {
  id: string;
  username: string; // email or username
  fullName: string;
  role: "admin" | "user" | "viewer";
  active: boolean;
  passwordHash: string;
  salt: string;
  createdAt: string;
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
};

declare global {
  interface Window {
    erpNative?: NativeBridge;
  }
}

const isBrowser = typeof window !== "undefined";
const native = () => (isBrowser ? window.erpNative : undefined);

const KEY = (table: string) => `erp:${table}`;

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

export async function upsertBy<T extends Record<string, any>>(
  table: string,
  row: T,
  key: keyof T,
): Promise<void> {
  const rows = await getAll<T>(table);
  const idx = rows.findIndex((r) => r[key] === row[key]);
  if (idx >= 0) rows[idx] = row;
  else rows.push(row);
  await setAll(table, rows);
}

export async function removeBy<T extends Record<string, any>>(
  table: string,
  key: keyof T,
  value: any,
): Promise<T | undefined> {
  const rows = await getAll<T>(table);
  const idx = rows.findIndex((r) => r[key] === value);
  if (idx < 0) return undefined;
  const [removed] = rows.splice(idx, 1);
  await setAll(table, rows);
  return removed;
}

// ---------- KV (single-value settings) ----------
export async function getKV<T = any>(key: string): Promise<T | null> {
  const n = native();
  if (n) return (await n.getKV(key)) as T | null;
  if (!isBrowser) return null;
  try {
    const raw = window.localStorage.getItem(KEY("kv:" + key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export async function setKV(key: string, value: any): Promise<void> {
  const n = native();
  if (n) return n.setKV(key, value);
  if (!isBrowser) return;
  window.localStorage.setItem(KEY("kv:" + key), JSON.stringify(value));
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
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
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
  const rows = await getAll<AuditEntry>(AUDIT_TABLE);
  const nextId = rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1;
  rows.unshift({
    id: nextId,
    created_at: new Date().toISOString(),
    ...entry,
  });
  if (rows.length > AUDIT_MAX) rows.length = AUDIT_MAX;
  await setAll(AUDIT_TABLE, rows);
}

export async function getAudit(): Promise<AuditEntry[]> {
  return getAll<AuditEntry>(AUDIT_TABLE);
}

// ---------- Convenience typed getters ----------
export const localDb = {
  suppliers: {
    list: () => getAll<Supplier>("suppliers"),
    upsert: (s: Supplier) => upsertBy("suppliers", s, "code"),
    remove: (code: string) => removeBy<Supplier>("suppliers", "code", code),
  },
  items: {
    list: () => getAll<Item>("items"),
    upsert: (i: Item) => upsertBy("items", i, "code"),
    remove: (code: string) => removeBy<Item>("items", "code", code),
  },
  purchaseOrders: {
    list: () => getAll<PurchaseOrder>("purchase_orders"),
    upsert: (p: PurchaseOrder) => upsertBy("purchase_orders", p, "number"),
    remove: (num: string) => removeBy<PurchaseOrder>("purchase_orders", "number", num),
  },
  users: {
    list: () => getAll<LocalUser>("users"),
    upsert: (u: LocalUser) => upsertBy("users", u, "id"),
    remove: (id: string) => removeBy<LocalUser>("users", "id", id),
  },
  settings: {
    get: (): Promise<Settings | null> => getKV<Settings>("settings"),
    set: (s: Settings) => setKV("settings", s),
  },
};

export function newId(): string {
  return "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}