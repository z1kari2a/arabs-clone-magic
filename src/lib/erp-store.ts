import { useSyncExternalStore, useEffect } from "react";
import type { Item, PurchaseOrder, Settings, Supplier, User } from "./erp-types";
import { localDb, logAudit, getCurrentScope } from "./local-db";
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
  // Same predicate the totals use — persisting a narrower set than what was
  // priced on screen made the invoice total change the moment it was saved.
  const validRows = po.rows.filter(isRealRow);
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

// ---- Wholesale list replacement ----
// The editing screens (dليل الأصناف / الموردون) hand back their COMPLETE list,
// so persisting it means replacing the table, not upserting row by row. An
// upsert loop can only ever add or overwrite: deleting a row, or renaming a
// record's code, left the original behind as an orphan that reappeared on the
// next reload. These helpers diff against storage so removals actually happen
// and every change still reaches the audit log.
async function replaceCollection<T extends Record<string, any>>(
  next: T[],
  key: keyof T & string,
  tableName: string,
  read: () => Promise<T[]>,
  write: (rows: T[]) => Promise<void>,
) {
  const prev = await read();
  await write(next);
  const user = currentUsername();
  const nextKeys = new Set(next.map((r) => r[key]));
  for (const old of prev) {
    if (!nextKeys.has(old[key])) {
      await logAudit({
        user_email: user,
        action: "DELETE",
        table_name: tableName,
        record_id: String(old[key]),
        before_data: old,
        after_data: null,
      });
    }
  }
  for (const row of next) {
    const before = prev.find((p) => p[key] === row[key]) ?? null;
    if (before && JSON.stringify(before) === JSON.stringify(row)) continue;
    await logAudit({
      user_email: user,
      action: before ? "UPDATE" : "INSERT",
      table_name: tableName,
      record_id: String(row[key]),
      before_data: before,
      after_data: row,
    });
  }
}

export async function replaceSuppliers(list: Supplier[]) {
  await replaceCollection(list, "code", "suppliers", localDb.suppliers.list, localDb.suppliers.replaceAll);
  setState({ suppliers: await localDb.suppliers.list() });
}

export async function replaceItems(list: Item[]) {
  await replaceCollection(list, "code", "items", localDb.items.list, localDb.items.replaceAll);
  setState({ items: await localDb.items.list() });
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

    // Collections passed here are the COMPLETE list — they replace the table.
    // Refuse to persist one before hydration has finished: a screen that
    // mounted with an empty list (see the useHydrate ordering) would otherwise
    // wipe the whole table the first time its save button was pressed.
    const collections = ["suppliers", "items", "purchaseOrders"] as const;
    const wholesale = collections.filter((k) => patch[k] !== undefined);
    if (wholesale.length && !state.hydrated) {
      console.warn(
        `[erpStore] refusing to persist ${wholesale.join("/")} before hydration — this would erase stored data`,
      );
      setState(patch);
      return;
    }

    if (patch.suppliers) void replaceSuppliers(patch.suppliers);
    if (patch.items) void replaceItems(patch.items);
    if (patch.purchaseOrders) {
      // Purchase orders keep their bespoke path: savePurchaseOrder pins exchange
      // rates and syncs the item catalog, and deletions must go through deletePO.
      const prev = state.purchaseOrders;
      const next = patch.purchaseOrders;
      const nextNumbers = new Set(next.map((p) => p.number));
      void (async () => {
        for (const old of prev) {
          if (!nextNumbers.has(old.number)) await deletePO(old.number);
        }
        for (const p of next) {
          if (!prev.find((x) => JSON.stringify(x) === JSON.stringify(p))) await savePurchaseOrder(p);
        }
      })();
    }
    setState(patch);
  },
  reset: async () => {
    await Promise.all([
      localDb.suppliers.replaceAll([]),
      localDb.items.replaceAll([]),
      localDb.purchaseOrders.replaceAll([]),
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
/**
 * A row that carries real data. This is the SINGLE definition of "counts" —
 * computePO's totals, the on-screen item count, and savePurchaseOrder's persist
 * filter all use it. They used to disagree (`model || name || qty > 0` on save
 * vs `model || name` on persist vs "every row" in the totals), so a row with a
 * quantity but no model was priced into the totals and then silently dropped by
 * the save, changing the invoice total after saving it.
 */
export function isRealRow(r: import("./erp-types").PORow): boolean {
  return Boolean(r.model || r.name || (r.qty || 0) > 0);
}

// ---- تمرير أمر الشراء المفتوح إلى شاشة «التسعيرات» ----
// شاشة التسعيرات تقرأ الفواتير المحفوظة، لكن المستخدم قد يضغط «التسعيرات» وهو
// يحرّر فاتورة لم تُحفظ بعد. نخزّن نسخة منها هنا عند الانتقال، وتقرأها الشاشة
// الأخرى إذا لم تجد الرقم بين المحفوظات. مفتاح مستقل عن مفتاح المسودّة عمداً:
// كتابة مسودّة لفاتورة محفوظة كانت ستُعيد فتحها في وضع التعديل عند الرجوع.
const handoffKey = () => `erp:po-handoff-v1:${getCurrentScope() ?? "anon"}`;

/** يحفظ نسخة من أمر الشراء الحالي قبل الانتقال إلى شاشة التسعيرات. */
export function stashPO(po: PurchaseOrder) {
  try { localStorage.setItem(handoffKey(), JSON.stringify(po)); } catch { /* ignore */ }
}

/** يقرأ أمر الشراء المُمرَّر من شاشة أمر الشراء (إن وُجد). */
export function readStashedPO(): PurchaseOrder | null {
  try {
    const raw = localStorage.getItem(handoffKey());
    return raw ? (JSON.parse(raw) as PurchaseOrder) : null;
  } catch {
    return null;
  }
}

// ---- Packages: the ONE unit that quantity, price and CBM all speak ----
// الكمية = عدد الطرود، مهما كانت تسمية الوحدة (كرتون، علبة، طرد، صندوق…).
// سعر الشراء = سعر الطرد الواحد، و CBM = حجم الطرد الواحد. لا فرق بين التسميات.
//
// العبوة (pack) is descriptive only — how many pieces sit inside one package. It
// used to be divided into the quantity, which shrank a 50-package line to 0.42
// packages: "إجمالي CBM" came out as 0.0417 instead of 5, and the order's total
// CBM (hence سعر CBM) was off by orders of magnitude. Nothing divides by it now.
/** عدد الطرود في السطر = الكمية. Basis for CBM and for every per-package cost. */
export function cartonsOf(r: import("./erp-types").PORow): number {
  return r.qty || 0;
}
/** إجمالي CBM للسطر = الكمية × CBM الطرد. */
export function lineCBMOf(r: import("./erp-types").PORow): number {
  return cartonsOf(r) * (r.cbm || 0);
}

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
  // Totals run over REAL rows only (see isRealRow) — the blank filler rows the
  // grid renders must never contribute to a total or to the item count.
  const realRows = po.rows.filter(isRealRow);
  const totalItems = realRows.length;
  const totalQty = realRows.reduce((s, r) => s + (r.qty || 0), 0);

  const rateOfRow = (r: import("./erp-types").PORow) => r.rate || liveRate(r.currency) || invRate;
  // "سعر الشراء" prices ONE PIECE, and العبوة is how many pieces the package
  // holds — so one package costs (السعر × العبوة). A missing/zero العبوة means
  // the price already is the package price; falling back to 1 keeps the money
  // intact instead of zeroing the whole line out.
  // تكلفة الشراء = (سعر الحبة × العبوة) ÷ سعر الصرف — one package, in USD.
  const piecesPerPackage = (r: import("./erp-types").PORow) => r.pack || 1;
  const cartonPurchaseCostOf = (r: import("./erp-types").PORow) => {
    const rate = rateOfRow(r);
    return rate > 0 ? (r.price * piecesPerPackage(r)) / rate : 0;
  };

  const totalCartons = realRows.reduce((s, r) => s + cartonsOf(r), 0);
  const totalCBM = realRows.reduce((s, r) => s + lineCBMOf(r), 0);
  const totalPurchase = realRows.reduce((s, r) => s + cartonsOf(r) * cartonPurchaseCostOf(r), 0);

  // All expenses convert straight to USD regardless of their own currency,
  // the PO's invoice currency, or the vendor's currency.
  const totalExpenses = po.expenses.reduce((s, e) => {
    const er = e.rate || liveRate(e.currency) || 0;
    return s + (er > 0 ? e.amount / er : 0);
  }, 0);

  // "سعر CBM" shown at the top of the order — ONE unified price for the whole
  // invoice: كل المصاريف ÷ إجمالي CBM لكل الأصناف. (2000 مصاريف ÷ 20 CBM = 100)
  // Every row is then charged r.cbm × cbmPrice per carton, so the allocation
  // always adds back up to the same total expenses.
  const cbmPrice = totalCBM > 0 ? totalExpenses / totalCBM : 0;
  // "نسبة المصروفات %" default suggestion — user may override on the document (po.expensePercentage).
  const suggestedPct = totalPurchase > 0 ? (totalExpenses / totalPurchase) * 100 : 0;
  const pctRate = po.expensePercentage ?? suggestedPct;
  const totalCost = totalPurchase + totalExpenses;

  // CBM distribution needs a non-zero total CBM to divide by. When no row carries
  // a CBM (the default for a fresh row), `cbmPrice` is 0 and the CBM column would
  // allocate NOTHING — the expenses vanish from every line while still sitting in
  // the header total, so sale prices come out below true cost. Fall back to the
  // proportional (percentage) basis, which distributes the same expenses correctly.
  const cbmBasisUnusable = totalCBM <= 0 && totalExpenses > 0;

  const rowMetrics = po.rows.map((r) => {
    const cartons = cartonsOf(r);
    const purchaseCost = cartonPurchaseCostOf(r); // تكلفة الشراء (لكرتون، USD)
    const lineCBM = cartons * r.cbm;
    // التكلفة المئوية (لكرتون) — proportional to purchase value.
    const pctCost = purchaseCost + purchaseCost * (pctRate / 100);
    // تكلفة CBM (لكرتون)
    const cbmCost = cbmBasisUnusable ? pctCost : r.cbm * cbmPrice + purchaseCost;
    const avgCost = (cbmCost + pctCost) / 2; // متوسط التكلفة (لكرتون)
    const selectedCost =
      po.distributionType === "cbm" ? cbmCost :
      po.distributionType === "percentage" ? pctCost :
      avgCost; // "average" and any legacy value (value/qty/avg) fall back to the average
    const allocatedExpPerCarton = selectedCost - purchaseCost; // مبلغ المصروف للكرتون
    const linePurchase = cartons * purchaseCost;
    // "إجمالي أمر الشراء" — ما يدفعه التاجر للمورد على هذا السطر، بعملة السطر
    // نفسها (ماشي بالدولار): الكمية × العبوة × سعر الحبة. مجموع العمود = قيمة
    // الفاتورة كما يصدرها المورد.
    const lineInvoiceTotal = cartons * r.price * piecesPerPackage(r);
    const allocatedExp = allocatedExpPerCarton * cartons;
    const lineTotalCost = selectedCost * cartons;
    return {
      cartons, purchaseCost, lineCBM, linePurchase, lineInvoiceTotal,
      cbmCost, pctCost, avgCost, selectedCost,
      allocatedExpPerCarton, allocatedExp, lineTotalCost,
    };
  });

  // What the per-row distribution ACTUALLY allocated, versus the real cash total.
  // These agree on every automatic basis, but a manually-typed "نسبة المصروفات %"
  // is free to over/under-allocate — the divergence used to be invisible, leaving
  // the header total and the sum of the item costs quietly contradicting each other.
  const allocatedExpenses = po.rows.reduce(
    (s, r, i) => (isRealRow(r) ? s + rowMetrics[i].allocatedExp : s),
    0,
  );
  const allocatedTotal = totalPurchase + allocatedExpenses;
  const allocationDiff = allocatedTotal - totalCost;
  const allocationBalanced = Math.abs(allocationDiff) < 0.005;

  // مجموع عمود "إجمالي أمر الشراء" = قيمة الفاتورة بعملتها.
  const totalInvoiceAmount = po.rows.reduce(
    (s, r, i) => (isRealRow(r) ? s + rowMetrics[i].lineInvoiceTotal : s),
    0,
  );

  return {
    totalItems, totalQty, totalPurchase, totalCBM, totalCartons, totalExpenses,
    cbmPrice, suggestedPct, pctRate, totalCost, rowMetrics, totalInvoiceAmount,
    cbmBasisUnusable, allocatedExpenses, allocatedTotal, allocationDiff, allocationBalanced,
  };
}

// Re-export savePurchaseOrder for old imports
export { savePurchaseOrder as savePO };
