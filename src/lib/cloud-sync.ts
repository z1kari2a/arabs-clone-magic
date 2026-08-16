// Cloud backup of local ERP data, piggybacking on the existing license/activation
// system instead of a separate per-user Supabase auth flow. Every push/pull is
// scoped server-side to the calling device's activation (see
// src/routes/api/public/license/backup.ts) — this module never talks to
// Supabase directly, only through that server route.
//
// Fully best-effort: with no license (e.g. running as a plain web app, or the
// non-shell Electron build), or no network, push/schedule silently no-op.
// Restoring is never automatic — only pullLatestCloudBackup(), called from an
// explicit user action, can overwrite local data.
import { localDb } from "./local-db";

type LicenseBridge = {
  status: () => Promise<{ session_token?: string; fingerprint?: string } | null>;
  serverBase: () => Promise<string>;
};

declare global {
  interface Window {
    erpLicense?: LicenseBridge;
  }
}

type BackupPayload = {
  suppliers: unknown[];
  items: unknown[];
  purchase_orders: unknown[];
  /** اختياري: نسخة قديمة محفوظة قبل إضافة «طلبات الشراء» لا تحوي هذا المفتاح. */
  purchase_requests?: unknown[];
  users: unknown[];
  settings: unknown;
};

async function endpoint(): Promise<string | null> {
  if (typeof window === "undefined" || !window.erpLicense) return null;
  try {
    const base = await window.erpLicense.serverBase();
    return base ? `${base}/api/public/license/backup` : null;
  } catch {
    return null;
  }
}

async function credentials(): Promise<{ session_token: string; fingerprint: string } | null> {
  if (typeof window === "undefined" || !window.erpLicense) return null;
  try {
    const status = await window.erpLicense.status();
    if (!status?.session_token || !status?.fingerprint) return null;
    return { session_token: status.session_token, fingerprint: status.fingerprint };
  } catch {
    return null;
  }
}

async function collectPayload(): Promise<BackupPayload> {
  const [suppliers, items, purchase_orders, purchase_requests, users, settings] = await Promise.all(
    [
      localDb.suppliers.list(),
      localDb.items.list(),
      localDb.purchaseOrders.list(),
      localDb.purchaseRequests.list(),
      localDb.users.list(),
      localDb.settings.get(),
    ],
  );
  return { suppliers, items, purchase_orders, purchase_requests, users, settings };
}

let lastPushedAt: string | null = null;
export function getLastCloudPushAt(): string | null {
  return lastPushedAt;
}

export async function pushCloudBackup(): Promise<boolean> {
  const url = await endpoint();
  const creds = await credentials();
  if (!url || !creds) return false;
  try {
    const payload = await collectPayload();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...creds, payload }),
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    if (json?.ok) {
      lastPushedAt = json.created_at ?? new Date().toISOString();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const DEBOUNCE_MS = 5000;
const FALLBACK_INTERVAL_MS = 30 * 60 * 1000;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;

/** Debounced push, called after any local mutation. Safe to call often. */
export function scheduleCloudBackup(): void {
  if (typeof window === "undefined") return;
  // The offline desktop build has no license bridge, so every push would be a
  // guaranteed no-op. Starting timers for it anyway meant a fetch attempt after
  // each edit plus one every 30 minutes forever, on a machine that may have no
  // network at all — and a blocked or hanging request is a stall the user sees.
  if (!window.erpLicense) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void pushCloudBackup();
  }, DEBOUNCE_MS);
  if (!fallbackTimer) {
    fallbackTimer = setInterval(() => {
      void pushCloudBackup();
    }, FALLBACK_INTERVAL_MS);
  }
}

/** Explicit, user-initiated restore. Never called automatically. */
export async function pullLatestCloudBackup(): Promise<BackupPayload | null> {
  const url = await endpoint();
  const creds = await credentials();
  if (!url || !creds) throw new Error("no_license");
  const qs = new URLSearchParams(creds).toString();
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) throw new Error(`http_${res.status}`);
  const json = await res.json();
  if (!json?.ok) throw new Error(json?.error ?? "pull_failed");
  return (json.payload as BackupPayload | null) ?? null;
}

/** Writes a pulled snapshot into local storage. Caller must hydrateStore() after. */
export async function restoreFromCloudBackup(payload: BackupPayload): Promise<void> {
  // One write per table. This used to clear each table row-by-row and then fire
  // a parallel upsert per record; because every upsert read the same empty
  // snapshot before any of them wrote, the last one won and each table was
  // restored with exactly ONE record. Writing the array in a single call makes
  // the restore both correct and atomic.
  await Promise.all([
    localDb.suppliers.replaceAll(
      (payload.suppliers ?? []) as Parameters<typeof localDb.suppliers.replaceAll>[0],
    ),
    localDb.items.replaceAll(
      (payload.items ?? []) as Parameters<typeof localDb.items.replaceAll>[0],
    ),
    localDb.purchaseOrders.replaceAll(
      (payload.purchase_orders ?? []) as Parameters<typeof localDb.purchaseOrders.replaceAll>[0],
    ),
    localDb.users.replaceAll(
      (payload.users ?? []) as Parameters<typeof localDb.users.replaceAll>[0],
    ),
  ]);
  // نسخة سحابية أُخذت قبل إضافة «طلبات الشراء» لا تحوي المفتاح أصلاً — نتركه كما
  // هو محلياً بدل أن نمسح طلبات موجودة باستعادة لقطة أقدم من الميزة نفسها.
  if (payload.purchase_requests) {
    await localDb.purchaseRequests.replaceAll(
      payload.purchase_requests as Parameters<typeof localDb.purchaseRequests.replaceAll>[0],
    );
  }
  if (payload.settings)
    await localDb.settings.set(payload.settings as Parameters<typeof localDb.settings.set>[0]);
}
