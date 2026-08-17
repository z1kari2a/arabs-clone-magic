import { useSyncExternalStore, useEffect } from "react";
import type {
  Expense,
  Item,
  PORow,
  PurchaseOrder,
  PurchaseRequest,
  Settings,
  Supplier,
  User,
} from "./erp-types";
import { localDb, logAudit, getCurrentScope, writeWebStorage } from "./local-db";
import { scheduleCloudBackup } from "./cloud-sync";

type StoreState = {
  suppliers: Supplier[];
  items: Item[];
  purchaseOrders: PurchaseOrder[];
  purchaseRequests: PurchaseRequest[];
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
    { id: "base", name: "التكلفة الأساسية", extraPct: 0, profitPct: 30 },
    { id: "aden", name: "تكلفة عدن", extraPct: 26.87, profitPct: 30 },
    { id: "sanaa", name: "تكلفة صنعاء", extraPct: 52.71, profitPct: 30 },
  ],
  currencies: [
    // Base currency is USD. `rate` = how many units of the currency equal 1 USD.
    // Example: 1 USD = 536 YER, 1 USD = 3.75 SAR, 1 USD = 7.18 CNY.
    { code: "USD", name: "دولار أمريكي", rate: 1 },
    { code: "YER", name: "ريال يمني", rate: 536 },
    { code: "SAR", name: "ريال سعودي", rate: 3.75 },
    { code: "CNY", name: "يوان صيني", rate: 7.18 },
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

/**
 * رقم صالح دائماً. كل قيمة تدخل الحساب تمرّ من هنا.
 *
 * السبب: استيراد Excel كان يقرأ الأرقام بـ`Number()` الخام، فخلية نصية واحدة
 * («-» أو مسافة أو اسم وقع في عمود الكمية) تُنتج NaN. وNaN معدٍ: يسري في كل
 * جمع وضرب حتى يبلغ مجاميع الفاتورة، ثم يعرضه `fmt()` رقماً هادئاً هو «0.00» —
 * فاتورة كاملة بأصفار لا يشكّ فيها أحد. الاستيراد نفسه أُصلح (sheet.ts: numCell)،
 * وهذه الحارسة هي الخط الثاني: مستند قديم محفوظ فيه NaN، أو أي مسار إدخال يُضاف
 * لاحقاً، لا يجوز أن يُسقط الحساب كله.
 */
const fin = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const initialState: StoreState = {
  suppliers: [],
  items: [],
  purchaseOrders: [],
  purchaseRequests: [],
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
const notify = () => {
  listeners.forEach((l) => l());
  scheduleCloudBackup();
};

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

// النطاق الذي رُطِّب المخزن لأجله. `useHydrate` تقرأه لتعرف هل القراءة الكاملة
// لازمة أصلاً — انظر تعليقها أدناه.
let hydratedScope: string | null = null;

export async function hydrateStore() {
  hydratedScope = getCurrentScope();
  const [suppliers, items, purchaseOrders, purchaseRequests, users, settings] = await Promise.all([
    localDb.suppliers.list(),
    localDb.items.list(),
    localDb.purchaseOrders.list(),
    localDb.purchaseRequests.list(),
    fetchUsers(),
    localDb.settings.get(),
  ]);
  setState({
    suppliers,
    items,
    purchaseOrders,
    purchaseRequests,
    users,
    settings: { ...defaultSettings, ...(settings ?? {}) },
    hydrated: true,
  });
}

/**
 * يضمن أن المخزن مُرطَّب — ولا يعيد الترطيب بلا داعٍ.
 *
 * يُستدعى من `ErpLayout`، والتخطيط يُعاد تركيبه مع كل انتقال بين شاشتين. فكان
 * كل نقرة تبويب تُعيد قراءة الموردين والأصناف وأوامر الشراء وطلبات الشراء
 * والمستخدمين والإعدادات كاملةً من التخزين — ست قراءات كاملة للتنقّل الواحد،
 * تمرّ في نسخة سطح المكتب عبر IPC وتُعيد رسم كل شاشة مفتوحة معها.
 *
 * القراءة تحدث الآن مرة واحدة لكل حساب. وما يُبطلها صراحةً يستدعي
 * `hydrateStore()` مباشرةً: تسجيل الدخول، والاستعادة من السحابة، وإعادة تعيين
 * النظام، وشاشة المستخدمين بعد كل تعديل. وتغيّر الحساب يُرصد بمقارنة النطاق،
 * فلا يرى المستخدم التالي بيانات سابقه.
 */
export function useHydrate() {
  useEffect(() => {
    if (state.hydrated && hydratedScope === getCurrentScope()) return;
    void hydrateStore();
  }, []);
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

// ============ إعادة تثبيت أسعار الصرف على مستند قيد التحرير ============
// كل سطر ومصروف يحمل سعر صرف مثبَّتاً عليه (savePurchaseOrder / costingBase)،
// وهذا هو الصحيح للمستندات المحفوظة: أرقامها لا تتحرك تحت تعديل لاحق على جدول
// العملات. لكنه كان يسري أيضاً على مستند ما زال المستخدم يحرّره — فيعدّل سعر
// الصرف في «أسعار الصرف» ولا يتغيّر شيء أمامه، لأن أسطره ثبّتت السعر لحظة
// إضافتها. هذه الدالة هي ما يقف خلف زر «تحديث الأسعار» في أمر/طلب الشراء:
// تعيد قراءة الجدول الحيّ وتكتبه على الرأس وكل الأسطر والمصروفات.
//
// سعر غير موجود في الجدول (عملة حُذفت مثلاً) يُبقي المثبَّت كما هو بدل أن يصفّر
// السطر — القسمة على صفر تعيد 0 في كل الحسابات.
export function repinRates<
  T extends { currency: string; rate: number; rows: PORow[]; expenses?: Expense[] },
>(doc: T): T {
  const currencies = state.settings.currencies ?? [];
  const live = (code?: string) => currencies.find((c) => c.code === code)?.rate ?? 0;
  const next: T = {
    ...doc,
    rate: live(doc.currency) || doc.rate,
    rows: doc.rows.map((r) => ({ ...r, rate: live(r.currency ?? doc.currency) || r.rate })),
  };
  if (doc.expenses) {
    next.expenses = doc.expenses.map((e) => ({ ...e, rate: live(e.currency) || e.rate }));
  }
  return next;
}

// ============ Mutations ============
function currentUsername(): string | null {
  if (state.session?.username) return state.session.username;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("erp:current-user");
    if (!raw) return null;
    return (JSON.parse(raw) as { username?: string }).username ?? null;
  } catch {
    return null;
  }
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

/** Raised when a write would overwrite an approved document. */
export class ApprovedDocumentError extends Error {
  readonly number: string;
  constructor(number: string) {
    super(`الأمر ${number} معتمد — لا يمكن تعديله. انسخه في أمر جديد (Ctrl+D).`);
    this.name = "ApprovedDocumentError";
    this.number = number;
  }
}

export type SaveDocumentOptions = {
  /**
   * Lets the write through even when the stored document is approved. Only the
   * restore/sync path sets this: it is reproducing a document that was already
   * approved elsewhere, not editing one here.
   */
  overwriteApproved?: boolean;
};

export async function savePurchaseOrder(po: PurchaseOrder, opts: SaveDocumentOptions = {}) {
  const prev = (await localDb.purchaseOrders.list()).find((p) => p.number === po.number) ?? null;

  // An approved purchase order is an accounting document: item costs and the
  // sale prices derived from them were computed off it. Editing it after the
  // fact silently changes numbers that decisions were already made on.
  //
  // Both screens that reach here disable their inputs when `approved` is set,
  // so this changes no existing flow — it moves the rule from the button to
  // the place the data is actually written, where the next caller (an import,
  // a new screen) cannot miss it.
  if (prev?.approved && !opts.overwriteApproved) {
    throw new ApprovedDocumentError(po.number);
  }

  // Same predicate the totals use — persisting a narrower set than what was
  // priced on screen made the invoice total change the moment it was saved.
  const validRows = po.rows.filter(isRealRow);
  // Pin exchange rates onto every entity so historical documents never shift
  // when settings.currencies rates are edited later.
  const currencies = state.settings.currencies ?? [];
  const rateOf = (code?: string) => fin(currencies.find((c) => c.code === code)?.rate);
  const pinnedInv = fin(po.rate) || rateOf(po.currency) || 1;
  const pinnedRows = validRows.map((r) => ({
    ...r,
    rate: fin(r.rate) || rateOf(r.currency) || pinnedInv,
  }));
  const pinnedExpenses = po.expenses.map((e) => ({
    ...e,
    rate: fin(e.rate) || rateOf(e.currency),
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

  // ---- Auto-create/update the items catalog ----
  // كل التعديلات تُجمع في الذاكرة أولاً ثم تُكتب دفعة واحدة. الحلقة السابقة كانت
  // تستدعي `items.upsert` لكل سطر، وكل استدعاء يقرأ جدول الأصناف كاملاً ويكتبه
  // كاملاً عبر IPC — أمر بمئة سطر على دليل فيه ألفا صنف كان يعني حتى مئتي دورة
  // قراءة‑وكتابة كاملة، وهو ما جعل حفظ فاتورة كبيرة يبدو كتجمّد. الآن كتابة واحدة.
  const items = await localDb.items.list();
  const byCode = new Map(items.map((i) => [i.code, i]));
  const touched = new Map<string, Item>();
  const stage = (it: Item) => {
    touched.set(it.code, it);
    byCode.set(it.code, it); // الأسطر التالية ترى أثر السابقة، تماماً كالحلقة القديمة
  };

  for (const row of pinnedRows) {
    if (!row.model) continue;
    const existing = byCode.get(row.model);
    if (!existing) {
      stage({
        code: row.model,
        name: row.name,
        barcode: "",
        units: [{ name: row.unit, pack: row.pack || 1, lastPrice: row.price }],
        cbmPerCarton: row.cbm,
        lastCost: 0,
        currency: row.currency || po.currency,
        rate: row.rate,
      });
    } else if (po.approved) {
      const units = [...existing.units];
      const idx = units.findIndex((u) => u.name === row.unit);
      if (idx >= 0) units[idx] = { ...units[idx], lastPrice: row.price, pack: row.pack };
      else units.push({ name: row.unit, pack: row.pack || 1, lastPrice: row.price });
      stage({
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
    for (let i = 0; i < pinnedRows.length; i++) {
      const m = metrics.rowMetrics[i];
      const it = byCode.get(pinnedRows[i].model);
      if (m && it) stage({ ...it, lastCost: m.selectedCost });
    }
  }
  if (touched.size) await localDb.items.upsertMany([...touched.values()]);

  setState({
    purchaseOrders: await localDb.purchaseOrders.list(),
    items: await localDb.items.list(),
  });
}

/**
 * حفظ طلب شراء. مختصر عمداً مقارنةً بـ savePurchaseOrder: الطلب مستند تقديري
 * قبل الشراء، فلا يُحدِّث دليل الأصناف ولا آخر تكلفة — لا شيء اشتُري بعد.
 * ما يشترك معه: تثبيت أسعار الصرف على المستند حتى لا تتغيّر أرقامه لاحقاً،
 * وتصفية الأسطر الفارغة بنفس isRealRow، وكتابة قيد التدقيق.
 */
export async function savePurchaseRequest(pr: PurchaseRequest, opts: SaveDocumentOptions = {}) {
  const prev = (await localDb.purchaseRequests.list()).find((p) => p.number === pr.number) ?? null;
  // Same rule as savePurchaseOrder: an approved request is what the order was
  // raised from, so it must not drift underneath it.
  if (prev?.approved && !opts.overwriteApproved) {
    throw new ApprovedDocumentError(pr.number);
  }
  const currencies = state.settings.currencies ?? [];
  const rateOf = (code?: string) => fin(currencies.find((c) => c.code === code)?.rate);
  const pinnedInv = fin(pr.rate) || rateOf(pr.currency) || 1;
  const clean: PurchaseRequest = {
    ...pr,
    rate: pinnedInv,
    rows: pr.rows.filter(isRealRow).map((r) => ({
      ...r,
      rate: fin(r.rate) || rateOf(r.currency) || pinnedInv,
    })),
  };
  await localDb.purchaseRequests.upsert(clean);
  await logAudit({
    user_email: currentUsername(),
    action: prev ? "UPDATE" : "INSERT",
    table_name: "purchase_requests",
    record_id: pr.number,
    before_data: prev,
    after_data: clean,
  });
  setState({ purchaseRequests: await localDb.purchaseRequests.list() });
}

export async function deletePurchaseRequest(number: string) {
  const removed = await localDb.purchaseRequests.remove(number);
  if (removed) {
    await logAudit({
      user_email: currentUsername(),
      action: "DELETE",
      table_name: "purchase_requests",
      record_id: number,
      before_data: removed,
      after_data: null,
    });
  }
  setState({ purchaseRequests: await localDb.purchaseRequests.list() });
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
  await replaceCollection(
    list,
    "code",
    "suppliers",
    localDb.suppliers.list,
    localDb.suppliers.replaceAll,
  );
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
    const collections = ["suppliers", "items", "purchaseOrders", "purchaseRequests"] as const;
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
          if (!prev.find((x) => JSON.stringify(x) === JSON.stringify(p)))
            // A restore reproduces documents as they were approved elsewhere;
            // it is the one caller allowed past the approved-document guard.
            await savePurchaseOrder(p, { overwriteApproved: true });
        }
      })();
    }
    if (patch.purchaseRequests) {
      // نفس مسار أوامر الشراء: الحذف عبر deletePurchaseRequest والحفظ عبر
      // savePurchaseRequest حتى يُكتب قيد التدقيق وتُثبَّت أسعار الصرف.
      const prev = state.purchaseRequests;
      const next = patch.purchaseRequests;
      const nextNumbers = new Set(next.map((p) => p.number));
      void (async () => {
        for (const old of prev) {
          if (!nextNumbers.has(old.number)) await deletePurchaseRequest(old.number);
        }
        for (const p of next) {
          if (!prev.find((x) => JSON.stringify(x) === JSON.stringify(p)))
            await savePurchaseRequest(p, { overwriteApproved: true });
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
      localDb.purchaseRequests.replaceAll([]),
      localDb.settings.set(defaultSettings),
    ]);
    await hydrateStore();
  },
  refresh: hydrateStore,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
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
  try {
    writeWebStorage(handoffKey(), po);
  } catch {
    // Reported by onStorageFull; the pricing screen falls back to an empty
    // sheet rather than blocking the navigation that triggered this.
  }
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
  return fin(r.qty);
}
/** إجمالي CBM للسطر = الكمية × CBM الطرد. */
export function lineCBMOf(r: import("./erp-types").PORow): number {
  return cartonsOf(r) * fin(r.cbm);
}

// ---- نواة الاحتساب المشتركة بين «أمر الشراء» و«طلب الشراء» ----
// الفرق الوحيد بين المستندين هو مصدر «سعر CBM» و«نسبة المصاريف %»: أمر الشراء
// يشتقّهما من المصروفات المسجّلة فعلاً، وطلب الشراء يأخذهما كما أدخلهما
// المستخدم يدوياً (لا شاشة مصروفات فيه). كل ما عدا ذلك — تحويل العملات، تكلفة
// الكرتون، أعمدة التوزيع الثلاثة والمجاميع — واحد بالضبط، فيعيش هنا مرّة واحدة
// حتى لا تنحرف حسابات الشاشتين عن بعضهما.
//
// USD is the ONLY reference currency for costing. Invoice currency (doc.currency)
// is used solely to price the goods on the rows; it plays no part in how
// expenses are computed or distributed. `rate` on any currency = units-per-USD,
// so converting anything straight to USD is always `amount / rate`.
type CostingDoc = {
  currency: string;
  rate: number;
  rows: PORow[];
  distributionType: "cbm" | "percentage" | "average";
};

function costingBase(doc: CostingDoc) {
  // Prefer PINNED rates stored on the document — fall back to live settings only
  // when the row/expense/header has no rate yet (e.g. a brand-new unsaved line).
  const currencies = state.settings.currencies ?? [];
  const liveRate = (code?: string) => fin(currencies.find((c) => c.code === code)?.rate);
  const invRate = fin(doc.rate) || liveRate(doc.currency) || 1;
  // Totals run over REAL rows only (see isRealRow) — the blank filler rows the
  // grid renders must never contribute to a total or to the item count.
  const realRows = doc.rows.filter(isRealRow);

  const rateOfRow = (r: PORow) => fin(r.rate) || liveRate(r.currency) || invRate;
  // "سعر الشراء" prices ONE PIECE, and العبوة is how many pieces the package
  // holds — so one package costs (السعر × العبوة). A missing/zero العبوة means
  // the price already is the package price; falling back to 1 keeps the money
  // intact instead of zeroing the whole line out.
  // تكلفة الشراء = (سعر الحبة × العبوة) ÷ سعر الصرف — one package, in USD.
  const piecesPerPackage = (r: PORow) => fin(r.pack) || 1;
  const cartonPurchaseCostOf = (r: PORow) => {
    const rate = rateOfRow(r);
    return rate > 0 ? (fin(r.price) * piecesPerPackage(r)) / rate : 0;
  };

  return {
    liveRate,
    invRate,
    piecesPerPackage,
    cartonPurchaseCostOf,
    totalItems: realRows.length,
    totalQty: realRows.reduce((s, r) => s + cartonsOf(r), 0),
    totalCartons: realRows.reduce((s, r) => s + cartonsOf(r), 0),
    totalCBM: realRows.reduce((s, r) => s + lineCBMOf(r), 0),
    totalPurchase: realRows.reduce((s, r) => s + cartonsOf(r) * cartonPurchaseCostOf(r), 0),
  };
}

/** توزيع المصاريف على الأسطر بالأسس الثلاثة، انطلاقاً من سعر CBM ونسبة المصاريف. */
function allocateRows(
  doc: CostingDoc,
  base: ReturnType<typeof costingBase>,
  opts: { cbmPrice: number; pctRate: number; cbmBasisUnusable: boolean },
) {
  const { cbmPrice, pctRate, cbmBasisUnusable } = opts;
  const rowMetrics = doc.rows.map((r) => {
    const cartons = cartonsOf(r);
    const purchaseCost = base.cartonPurchaseCostOf(r); // تكلفة الشراء (لكرتون، USD)
    const lineCBM = lineCBMOf(r);
    // التكلفة المئوية (لكرتون) — proportional to purchase value.
    const pctCost = purchaseCost + purchaseCost * (fin(pctRate) / 100);
    // تكلفة CBM (لكرتون)
    const cbmCost = cbmBasisUnusable ? pctCost : fin(r.cbm) * cbmPrice + purchaseCost;
    const avgCost = (cbmCost + pctCost) / 2; // متوسط التكلفة (لكرتون)
    const selectedCost =
      doc.distributionType === "cbm"
        ? cbmCost
        : doc.distributionType === "percentage"
          ? pctCost
          : avgCost; // "average" and any legacy value (value/qty/avg) fall back to the average
    const allocatedExpPerCarton = selectedCost - purchaseCost; // مبلغ المصروف للكرتون
    const linePurchase = cartons * purchaseCost;
    // "إجمالي أمر الشراء" — ما يدفعه التاجر للمورد على هذا السطر، بعملة السطر
    // نفسها (ماشي بالدولار): الكمية × العبوة × سعر الحبة. مجموع العمود = قيمة
    // الفاتورة كما يصدرها المورد.
    const lineInvoiceTotal = cartons * fin(r.price) * base.piecesPerPackage(r);
    const allocatedExp = allocatedExpPerCarton * cartons;
    const lineTotalCost = selectedCost * cartons;
    return {
      cartons,
      purchaseCost,
      lineCBM,
      linePurchase,
      lineInvoiceTotal,
      cbmCost,
      pctCost,
      avgCost,
      selectedCost,
      allocatedExpPerCarton,
      allocatedExp,
      lineTotalCost,
    };
  });

  // ما وزّعته الأسطر فعلاً، ومجموع عمود "إجمالي أمر الشراء" بعملة الفاتورة.
  const allocatedExpenses = doc.rows.reduce(
    (s, r, i) => (isRealRow(r) ? s + rowMetrics[i].allocatedExp : s),
    0,
  );
  const totalInvoiceAmount = doc.rows.reduce(
    (s, r, i) => (isRealRow(r) ? s + rowMetrics[i].lineInvoiceTotal : s),
    0,
  );
  return { rowMetrics, allocatedExpenses, totalInvoiceAmount };
}

export function computePO(po: PurchaseOrder) {
  const base = costingBase(po);
  const { totalCBM, totalPurchase } = base;

  // All expenses convert straight to USD regardless of their own currency,
  // the PO's invoice currency, or the vendor's currency.
  const totalExpenses = po.expenses.reduce((s, e) => {
    const er = fin(e.rate) || base.liveRate(e.currency);
    return s + (er > 0 ? fin(e.amount) / er : 0);
  }, 0);

  // "سعر CBM" shown at the top of the order — ONE unified price for the whole
  // invoice: كل المصاريف ÷ إجمالي CBM لكل الأصناف. (2000 مصاريف ÷ 20 CBM = 100)
  // Every row is then charged r.cbm × cbmPrice per carton, so the allocation
  // always adds back up to the same total expenses.
  const cbmPrice = totalCBM > 0 ? totalExpenses / totalCBM : 0;
  // "نسبة المصروفات %" default suggestion — user may override on the document (po.expensePercentage).
  const suggestedPct = totalPurchase > 0 ? (totalExpenses / totalPurchase) * 100 : 0;
  // نسبة مكتوبة يدوياً تُحترم حتى لو كانت صفراً (لذلك ليست `||`)، لكن نسبة غير
  // صالحة محفوظة على مستند قديم تعود إلى النسبة المقترحة بدل أن تُفسد التوزيع.
  const pctRate = Number.isFinite(po.expensePercentage)
    ? (po.expensePercentage as number)
    : suggestedPct;
  const totalCost = totalPurchase + totalExpenses;

  // CBM distribution needs a non-zero total CBM to divide by. When no row carries
  // a CBM (the default for a fresh row), `cbmPrice` is 0 and the CBM column would
  // allocate NOTHING — the expenses vanish from every line while still sitting in
  // the header total, so sale prices come out below true cost. Fall back to the
  // proportional (percentage) basis, which distributes the same expenses correctly.
  const cbmBasisUnusable = totalCBM <= 0 && totalExpenses > 0;

  const { rowMetrics, allocatedExpenses, totalInvoiceAmount } = allocateRows(po, base, {
    cbmPrice,
    pctRate,
    cbmBasisUnusable,
  });

  // What the per-row distribution ACTUALLY allocated, versus the real cash total.
  // These agree on every automatic basis, but a manually-typed "نسبة المصروفات %"
  // is free to over/under-allocate — the divergence used to be invisible, leaving
  // the header total and the sum of the item costs quietly contradicting each other.
  const allocatedTotal = totalPurchase + allocatedExpenses;
  const allocationDiff = allocatedTotal - totalCost;
  const allocationBalanced = Math.abs(allocationDiff) < 0.005;

  return {
    totalItems: base.totalItems,
    totalQty: base.totalQty,
    totalPurchase,
    totalCBM,
    totalCartons: base.totalCartons,
    totalExpenses,
    cbmPrice,
    suggestedPct,
    pctRate,
    totalCost,
    rowMetrics,
    totalInvoiceAmount,
    cbmBasisUnusable,
    allocatedExpenses,
    allocatedTotal,
    allocationDiff,
    allocationBalanced,
  };
}

/**
 * احتساب «طلب الشراء». لا مصروفات مسجّلة هنا: «سعر CBM» و«نسبة المصاريف %»
 * يُدخلان يدوياً، والمصروفات التقديرية هي ما وزّعته الأسطر فعلاً على الأساس
 * المختار — فيبقى إجمالي التكلفة مطابقاً دائماً لمجموع تكاليف الأصناف، ولا
 * يظهر أي فرق توزيع كالذي قد يحدث في أمر الشراء.
 */
export function computePR(pr: PurchaseRequest) {
  const base = costingBase(pr);
  const { totalCBM, totalPurchase } = base;

  const cbmPrice = fin(pr.cbmPrice);
  const pctRate = fin(pr.expensePercentage);
  // نفس حارس أمر الشراء: توزيع حسب CBM بلا أي CBM مُدخل لا يوزّع شيئاً، فنرجع
  // إلى الأساس النسبي بدل أن تختفي المصاريف من الأسطر.
  const cbmBasisUnusable = totalCBM <= 0 && cbmPrice > 0;

  const { rowMetrics, allocatedExpenses, totalInvoiceAmount } = allocateRows(pr, base, {
    cbmPrice,
    pctRate,
    cbmBasisUnusable,
  });

  const totalExpenses = allocatedExpenses; // مصاريف تقديرية، لا فواتير فعلية
  const totalCost = totalPurchase + totalExpenses;

  return {
    totalItems: base.totalItems,
    totalQty: base.totalQty,
    totalPurchase,
    totalCBM,
    totalCartons: base.totalCartons,
    totalExpenses,
    cbmPrice,
    pctRate,
    totalCost,
    rowMetrics,
    totalInvoiceAmount,
    cbmBasisUnusable,
    allocatedExpenses,
  };
}

// Re-export savePurchaseOrder for old imports
export { savePurchaseOrder as savePO };
