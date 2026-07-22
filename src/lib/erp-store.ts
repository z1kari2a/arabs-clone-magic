import { useSyncExternalStore, useEffect } from "react";
import type { Item, PurchaseOrder, Settings, Supplier, User } from "./erp-types";
import { localDb, logAudit } from "./local-db";

type StoreState = {
  suppliers: Supplier[];
  items: Item[];
  purchaseOrders: PurchaseOrder[];
  users: User[];
  settings: Settings;
  session: { username: string } | null;
  hydrated: boolean;
};

const SETTINGS_KEY = "erp-settings-v1";

const defaultSettings: Settings = {
  companyName: "شركتي للتجارة العامة",
  defaultCurrency: "USD",
  fiscalYear: String(new Date().getFullYear()),
  language: "ar",
  priceTiers: [
    { id: "base",  name: "التكلفة الأساسية", extraPct: 0,     profitPct: 30 },
    { id: "aden",  name: "تكلفة عدن",        extraPct: 26.87, profitPct: 30 },
    { id: "sanaa", name: "تكلفة صنعاء",      extraPct: 52.71, profitPct: 30 },
  ],
};

const initialState: StoreState = {
  suppliers: [],
  items: [],
  purchaseOrders: [],
  users: [],
  settings: loadSettings(),
  session: null,
  hydrated: false,
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  } catch { return defaultSettings; }
}
function saveSettings(s: Settings) {
  if (typeof window !== "undefined") window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

let state: StoreState = initialState;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  if (patch.settings) saveSettings(state.settings);
  notify();
}

// ============ Fetchers ============
// ============ Hydration ============
async function fetchUsers(): Promise<User[]> {
  const list = await localDb.users.list();
  return list.map((u) => ({
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    active: u.active !== false,
  }));
}

export async function hydrateStore() {
  const [suppliers, items, purchaseOrders, users, settings] = await Promise.all([
    localDb.suppliers.list(),
    localDb.items.list(),
    localDb.purchaseOrders.list(),
    fetchUsers(),
    localDb.settings.get(),
  ]);
  setState({
    suppliers,
    items,
    purchaseOrders,
    users,
    settings: { ...defaultSettings, ...(settings ?? {}) },
    hydrated: true,
  });
}

export function useHydrate() {
  useEffect(() => { void hydrateStore(); }, []);
}

// ============ Mutations ============
function currentUsername(): string | null {
  if (state.session?.username) return state.session.username;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("erp:current-user");
    if (!raw) return null;
    return (JSON.parse(raw) as { username?: string }).username ?? null;
  } catch { return null; }
}

export async function upsertSupplier(sup: Supplier) {
  const prev = (await localDb.suppliers.list()).find((s) => s.code === sup.code) ?? null;
  await localDb.suppliers.upsert(sup);
  await logAudit({
    user_email: currentUsername(),
    action: prev ? "UPDATE" : "INSERT",
    table_name: "suppliers",
    record_id: sup.code,
    before_data: prev,
    after_data: sup,
  });
  setState({ suppliers: await localDb.suppliers.list() });
}
export async function deleteSupplier(code: string) {
  const removed = await localDb.suppliers.remove(code);
  if (removed) {
    await logAudit({
      user_email: currentUsername(),
      action: "DELETE",
      table_name: "suppliers",
      record_id: code,
      before_data: removed,
      after_data: null,
    });
  }
  setState({ suppliers: await localDb.suppliers.list() });
}

export async function upsertItem(it: Item) {
  const prev = (await localDb.items.list()).find((x) => x.code === it.code) ?? null;
  await localDb.items.upsert(it);
  await logAudit({
    user_email: currentUsername(),
    action: prev ? "UPDATE" : "INSERT",
    table_name: "items",
    record_id: it.code,
    before_data: prev,
    after_data: it,
  });
  setState({ items: await localDb.items.list() });
}
export async function deleteItem(code: string) {
  const removed = await localDb.items.remove(code);
  if (removed) {
    await logAudit({
      user_email: currentUsername(),
      action: "DELETE",
      table_name: "items",
      record_id: code,
      before_data: removed,
      after_data: null,
    });
  }
  setState({ items: await localDb.items.list() });
}

export async function savePurchaseOrder(po: PurchaseOrder) {
  const prev = (await localDb.purchaseOrders.list()).find((p) => p.number === po.number) ?? null;
  const validRows = po.rows.filter((r) => r.model || r.name);
  const clean: PurchaseOrder = { ...po, rows: validRows };
  await localDb.purchaseOrders.upsert(clean);
  await logAudit({
    user_email: currentUsername(),
    action: prev ? "UPDATE" : "INSERT",
    table_name: "purchase_orders",
    record_id: po.number,
    before_data: prev,
    after_data: clean,
  });

  // Auto-create/update items catalog
  const items = await localDb.items.list();
  for (const row of validRows) {
    if (!row.model) continue;
    const existing = items.find((i) => i.code === row.model);
    if (!existing) {
      const newItem: Item = {
        code: row.model,
        name: row.name,
        barcode: "",
        units: [{ name: row.unit, pack: row.pack || 1, lastPrice: row.price }],
        cbmPerCarton: row.cbm,
        lastCost: 0,
      };
      await localDb.items.upsert(newItem);
    } else if (po.approved) {
      const units = [...existing.units];
      const idx = units.findIndex((u) => u.name === row.unit);
      if (idx >= 0) units[idx] = { ...units[idx], lastPrice: row.price, pack: row.pack };
      else units.push({ name: row.unit, pack: row.pack || 1, lastPrice: row.price });
      await localDb.items.upsert({ ...existing, units, cbmPerCarton: row.cbm });
    }
  }
  if (po.approved) {
    const metrics = computePO(clean);
    const list = await localDb.items.list();
    for (let i = 0; i < validRows.length; i++) {
      const m = metrics.rowMetrics[i];
      const it = list.find((x) => x.code === validRows[i].model);
      if (m && it) await localDb.items.upsert({ ...it, lastCost: m.avgCost });
    }
  }
  setState({
    purchaseOrders: await localDb.purchaseOrders.list(),
    items: await localDb.items.list(),
  });
}

export async function deletePO(number: string) {
  const removed = await localDb.purchaseOrders.remove(number);
  if (removed) {
    await logAudit({
      user_email: currentUsername(),
      action: "DELETE",
      table_name: "purchase_orders",
      record_id: number,
      before_data: removed,
      after_data: null,
    });
  }
  setState({ purchaseOrders: await localDb.purchaseOrders.list() });
}

// ============ Store API (compat with old code) ============
export const erpStore = {
  get: () => state,
  set: (patch: Partial<StoreState>) => {
    if (patch.settings) void localDb.settings.set(patch.settings);
    if (patch.suppliers) void patch.suppliers.forEach((s) => upsertSupplier(s));
    if (patch.items) void patch.items.forEach((i) => upsertItem(i));
    if (patch.purchaseOrders) {
      const prev = state.purchaseOrders;
      const changed = patch.purchaseOrders.filter(
        (p) => !prev.find((x) => JSON.stringify(x) === JSON.stringify(p)),
      );
      changed.forEach((p) => void savePurchaseOrder(p));
    }
    setState(patch);
  },
  reset: async () => {
    await Promise.all([
      localDb.suppliers.list().then((l) => l.forEach((s) => localDb.suppliers.remove(s.code))),
      localDb.items.list().then((l) => l.forEach((i) => localDb.items.remove(i.code))),
      localDb.purchaseOrders.list().then((l) => l.forEach((p) => localDb.purchaseOrders.remove(p.number))),
      localDb.settings.set(defaultSettings),
    ]);
    await hydrateStore();
  },
  refresh: hydrateStore,
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
};

export function useErpStore<T>(selector: (s: StoreState) => T): T {
  return useSyncExternalStore(
    (cb) => erpStore.subscribe(cb),
    () => selector(state),
    () => selector(initialState),
  );
}

// ============ Business logic (unchanged) ============
export function computePO(po: PurchaseOrder) {
  const totalItems = po.rows.filter((r) => r.model || r.name).length;
  const totalQty = po.rows.reduce((s, r) => s + (r.qty || 0), 0);
  const totalPurchase = po.rows.reduce((s, r) => s + r.qty * r.price, 0);
  const totalCBM = po.rows.reduce((s, r) => {
    const cartons = r.pack ? r.qty / r.pack : 0;
    return s + cartons * r.cbm;
  }, 0);
  const totalCartons = po.rows.reduce((s, r) => s + (r.pack ? r.qty / r.pack : 0), 0);
  const totalExpenses = po.expenses.reduce((s, e) => s + e.amount * (e.rate || 1), 0);
  const cbmPrice = totalCBM > 0 ? totalExpenses / totalCBM : 0;
  const totalCost = totalPurchase + totalExpenses;
  const rowMetrics = po.rows.map((r) => {
    const cartons = r.pack ? r.qty / r.pack : 0;
    const linePurchase = r.qty * r.price;
    const lineCBM = cartons * r.cbm;
    let allocatedExp = 0;
    if (po.distributionType === "cbm" && totalCBM > 0) allocatedExp = (lineCBM / totalCBM) * totalExpenses;
    else if (po.distributionType === "value" && totalPurchase > 0) allocatedExp = (linePurchase / totalPurchase) * totalExpenses;
    else if (po.distributionType === "qty" && totalQty > 0) allocatedExp = (r.qty / totalQty) * totalExpenses;
    else if (po.distributionType === "avg") {
      const byCbm = totalCBM > 0 ? (lineCBM / totalCBM) * totalExpenses : 0;
      const byVal = totalPurchase > 0 ? (linePurchase / totalPurchase) * totalExpenses : 0;
      allocatedExp = (byCbm + byVal) / 2;
    }
    const cbmCost = r.qty ? allocatedExp / r.qty : 0;
    const avgCost = r.price + cbmCost;
    const lineTotalCost = avgCost * r.qty;
    const pctCost = linePurchase > 0 ? (allocatedExp / linePurchase) * 100 : 0;
    return { cartons, linePurchase, lineCBM, allocatedExp, cbmCost, avgCost, lineTotalCost, pctCost };
  });
  return { totalItems, totalQty, totalPurchase, totalCBM, totalCartons, totalExpenses, cbmPrice, totalCost, rowMetrics };
}

// Re-export savePurchaseOrder for old imports
export { savePurchaseOrder as savePO };
