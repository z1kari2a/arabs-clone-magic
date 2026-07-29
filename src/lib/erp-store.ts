import { useSyncExternalStore, useEffect } from "react";
import type { Item, PurchaseOrder, Settings, Supplier, User } from "./erp-types";
import { localDb, logAudit } from "./local-db";
import { scheduleCloudBackup } from "./cloud-sync";

type StoreState = {
  suppliers: Supplier[];
  items: Item[];
  purchaseOrders: PurchaseOrder[];
  users: User[];
  settings: Settings;
  session: { username: string } | null;
  hydrated: boolean;
};

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
  currencies: [
    // Base currency is USD. `rate` = how many units of the currency equal 1 USD.
    // Example: 1 USD = 536 YER, 1 USD = 3.75 SAR, 1 USD = 7.18 CNY.
    { code: "USD", name: "دولار أمريكي", rate: 1 },
    { code: "YER", name: "ريال يمني",    rate: 536 },
    { code: "SAR", name: "ريال سعودي",   rate: 3.75 },
    { code: "CNY", name: "يوان صيني",    rate: 7.18 },
  ],
  expenseTypes: [
    "شحن بحري",
    "تخليص جمركي",
    "نقل داخلي",
    "تأمين",
    "ضرائب",
    "رسوم جمركية",
    "عمولة",
    "مصاريف بنكية",
    "تخزين",
    "أخرى",
  ],
};

const initialState: StoreState = {
  suppliers: [],
  items: [],
  purchaseOrders: [],
  users: [],
  settings: defaultSettings,
  session: null,
  hydrated: false,
};

// Settings persist exclusively through localDb.settings (erp:kv:settings, or its
// per-user scoped variant) — see hydrateStore() below and erpStore.set()'s
// `if (patch.settings) void localDb.settings.set(patch.settings)`. There used to
// be a second, unscoped `erp-settings-v1` localStorage key written here too,
// which could desync from the scoped value; removed in favor of one source of truth.
let state: StoreState = initialState;
const listeners = new Set<() => void>();
// Single integration point for the optional cloud backup (src/lib/cloud-sync.ts):
// every state change — supplier/item/PO/settings edits, and hydration itself —
// schedules a debounced push. No-ops silently when there's no active license.
const notify = () => { listeners.forEach((l) => l()); scheduleCloudBackup(); };

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
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
    pending: u.pending === true,
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

// ============ Currency rate helper ============
/** Update the exchange rate of a currency inline (from any screen that shows the currency). */
export function updateCurrencyRate(code: string, rate: number) {
  const list = state.settings.currencies ?? [];
  if (!list.some((c) => c.code === code)) return;
  const nextList = list.map((c) => (c.code === code ? { ...c, rate } : c));
  const nextSettings = { ...state.settings, currencies: nextList };
  void localDb.settings.set(nextSettings);
  setState({ settings: nextSettings });
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
  // Pin exchange rates onto every entity so historical documents never shift
  // when settings.currencies rates are edited later.
  const currencies = state.settings.currencies ?? [];
  const rateOf = (code?: string) => currencies.find((c) => c.code === code)?.rate ?? 0;
  const pinnedInv = po.rate || rateOf(po.currency) || 1;
  const pinnedRows = validRows.map((r) => ({
    ...r,
    rate: r.rate || rateOf(r.currency) || pinnedInv,
  }));
  const pinnedExpenses = po.expenses.map((e) => ({
    ...e,
    rate: e.rate || rateOf(e.currency) || 0,
  }));
  const clean: PurchaseOrder = {
    ...po,
    rate: pinnedInv,
    rows: pinnedRows,
    expenses: pinnedExpenses,
  };
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
  for (const row of pinnedRows) {
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
        currency: row.currency || po.currency,
        rate: row.rate,
      };
      await localDb.items.upsert(newItem);
    } else if (po.approved) {
      const units = [...existing.units];
      const idx = units.findIndex((u) => u.name === row.unit);
      if (idx >= 0) units[idx] = { ...units[idx], lastPrice: row.price, pack: row.pack };
      else units.push({ name: row.unit, pack: row.pack || 1, lastPrice: row.price });
      await localDb.items.upsert({
        ...existing,
        units,
        cbmPerCarton: row.cbm,
        currency: row.currency || existing.currency || po.currency,
        rate: row.rate ?? existing.rate,
      });
    }
  }
  if (po.approved) {
    const metrics = computePO(clean);
    const list = await localDb.items.list();
    for (let i = 0; i < pinnedRows.length; i++) {
      const m = metrics.rowMetrics[i];
      const it = list.find((x) => x.code === pinnedRows[i].model);
      if (m && it) await localDb.items.upsert({ ...it, lastCost: m.selectedCost });
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

// ============ Business logic ============
// USD is the ONLY reference currency for costing. Invoice currency (po.currency)
// is used solely to price the goods on the rows; it plays no part in how
// expenses are computed or distributed. `rate` on any currency = units-per-USD,
// so converting anything straight to USD is always `amount / rate`.
export function computePO(po: PurchaseOrder) {
  // Prefer PINNED rates stored on the document — fall back to live settings only
  // when the row/expense/header has no rate yet (e.g. a brand-new unsaved line).
  const currencies = state.settings.currencies ?? [];
  const liveRate = (code?: string) => currencies.find((c) => c.code === code)?.rate ?? 0;
  const invRate = po.rate || liveRate(po.currency) || 1;
  const totalItems = po.rows.filter((r) => r.model || r.name).length;
  const totalQty = po.rows.reduce((s, r) => s + (r.qty || 0), 0);

  const rateOfRow = (r: import("./erp-types").PORow) => r.rate || liveRate(r.currency) || invRate;
  // تكلفة الشراء = (سعر شراء الوحدة × العبوة) ÷ سعر صرف الفاتورة — one carton, in USD.
  const cartonPurchaseCostOf = (r: import("./erp-types").PORow) => {
    const rate = rateOfRow(r);
    return rate > 0 ? (r.price * (r.pack || 0)) / rate : 0;
  };

  const totalCartons = po.rows.reduce((s, r) => s + (r.pack ? r.qty / r.pack : 0), 0);
  const totalCBM = po.rows.reduce((s, r) => {
    const cartons = r.pack ? r.qty / r.pack : 0;
    return s + cartons * r.cbm;
  }, 0);
  const totalPurchase = po.rows.reduce((s, r) => {
    const cartons = r.pack ? r.qty / r.pack : 0;
    return s + cartons * cartonPurchaseCostOf(r);
  }, 0);

  // All expenses convert straight to USD regardless of their own currency,
  // the PO's invoice currency, or the vendor's currency.
  const totalExpenses = po.expenses.reduce((s, e) => {
    const er = e.rate || liveRate(e.currency) || 0;
    return s + (er > 0 ? e.amount / er : 0);
  }, 0);

  // "سعر CBM" shown at the top of the order — total expenses spread over total CBM.
  const cbmPrice = totalCBM > 0 ? totalExpenses / totalCBM : 0;
  // "نسبة المصروفات %" default suggestion — user may override on the document (po.expensePercentage).
  const suggestedPct = totalPurchase > 0 ? (totalExpenses / totalPurchase) * 100 : 0;
  const pctRate = po.expensePercentage ?? suggestedPct;
  const totalCost = totalPurchase + totalExpenses;

  const rowMetrics = po.rows.map((r) => {
    const cartons = r.pack ? r.qty / r.pack : 0;
    const purchaseCost = cartonPurchaseCostOf(r); // تكلفة الشراء (لكرتون، USD)
    const lineCBM = cartons * r.cbm;
    const cbmCost = r.cbm * cbmPrice + purchaseCost; // تكلفة CBM (لكرتون)
    const pctCost = purchaseCost + purchaseCost * (pctRate / 100); // التكلفة المئوية (لكرتون)
    const avgCost = (cbmCost + pctCost) / 2; // متوسط التكلفة (لكرتون)
    const selectedCost =
      po.distributionType === "cbm" ? cbmCost :
      po.distributionType === "percentage" ? pctCost :
      avgCost; // "average" and any legacy value (value/qty/avg) fall back to the average
    const allocatedExpPerCarton = selectedCost - purchaseCost; // مبلغ المصروف للكرتون
    const linePurchase = cartons * purchaseCost;
    const allocatedExp = allocatedExpPerCarton * cartons;
    const lineTotalCost = selectedCost * cartons;
    return {
      cartons, purchaseCost, lineCBM, linePurchase,
      cbmCost, pctCost, avgCost, selectedCost,
      allocatedExpPerCarton, allocatedExp, lineTotalCost,
    };
  });
  return {
    totalItems, totalQty, totalPurchase, totalCBM, totalCartons, totalExpenses,
    cbmPrice, suggestedPct, pctRate, totalCost, rowMetrics,
  };
}

// Re-export savePurchaseOrder for old imports
export { savePurchaseOrder as savePO };
