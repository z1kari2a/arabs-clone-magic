import { useSyncExternalStore } from "react";
import type {
  Expense,
  Item,
  PurchaseOrder,
  Settings,
  Supplier,
  User,
} from "./erp-types";

type StoreState = {
  suppliers: Supplier[];
  items: Item[];
  purchaseOrders: PurchaseOrder[];
  users: User[];
  settings: Settings;
  session: { username: string } | null;
};

const KEY = "erp-store-v1";

const defaultState: StoreState = {
  suppliers: [
    { code: "SUP0001", name: "شركة الأمل للتجارة", country: "الصين", city: "قوانغتشو", phone: "+86 20 1234 5678", email: "amal@example.com", currency: "USD", notes: "", active: true },
    { code: "SUP0002", name: "مؤسسة النور للاستيراد", country: "تركيا", city: "إسطنبول", phone: "+90 212 555 0000", email: "nour@example.com", currency: "USD", notes: "", active: true },
  ],
  items: [
    { code: "MOD-1001", name: "سماعة بلوتوث A10", barcode: "6921547856321", units: [{ name: "حبة", pack: 24, lastPrice: 4.5 }], cbmPerCarton: 0.06, lastCost: 0 },
    { code: "MOD-1002", name: "شاحن سريع 20W", barcode: "6921547856322", units: [{ name: "حبة", pack: 20, lastPrice: 3.2 }], cbmPerCarton: 0.04, lastCost: 0 },
    { code: "MOD-1003", name: "كابل بيانات Type-C", barcode: "6921547856323", units: [{ name: "حبة", pack: 15, lastPrice: 1.1 }], cbmPerCarton: 0.02, lastCost: 0 },
    { code: "MOD-1004", name: "باور بانك 10000mAh", barcode: "6921547856324", units: [{ name: "حبة", pack: 12, lastPrice: 6.8 }], cbmPerCarton: 0.08, lastCost: 0 },
    { code: "MOD-1005", name: "سماعة سلكية Y20", barcode: "6921547856325", units: [{ name: "حبة", pack: 8, lastPrice: 2.0 }], cbmPerCarton: 0.03, lastCost: 0 },
  ],
  purchaseOrders: [
    {
      number: "PO-2024-00056",
      date: "2024/05/19",
      invoiceNo: "INV-2024-0487",
      supplierCode: "SUP0001",
      currency: "USD",
      rate: 3.75,
      containerNo: "TCLU1234567",
      containerSize: "40 قدم HQ",
      distributionType: "cbm",
      notes: "",
      rows: [
        { id: 1, model: "MOD-1001", name: "سماعة بلوتوث A10", unit: "حبة", pack: 24, qty: 240, price: 4.5, cbm: 0.06 },
        { id: 2, model: "MOD-1002", name: "شاحن سريع 20W", unit: "حبة", pack: 20, qty: 480, price: 3.2, cbm: 0.04 },
        { id: 3, model: "MOD-1003", name: "كابل بيانات Type-C", unit: "حبة", pack: 15, qty: 1500, price: 1.1, cbm: 0.02 },
        { id: 4, model: "MOD-1004", name: "باور بانك 10000mAh", unit: "حبة", pack: 12, qty: 240, price: 6.8, cbm: 0.08 },
        { id: 5, model: "MOD-1005", name: "سماعة سلكية Y20", unit: "حبة", pack: 8, qty: 400, price: 2.0, cbm: 0.03 },
      ],
      expenses: [
        { id: 1, type: "شحن بحري", note: "أجرة شحن الحاوية", currency: "USD", amount: 100, rate: 1, },
        { id: 2, type: "جمارك", note: "رسوم جمركية", currency: "USD", amount: 32.72, rate: 1 },
      ],
      approved: false,
    },
  ],
  users: [
    { username: "admin", fullName: "المدير العام", role: "admin", active: true },
    { username: "user1", fullName: "محاسب المخزون", role: "user", active: true },
  ],
  settings: {
    companyName: "شركتي للتجارة العامة",
    defaultCurrency: "USD",
    fiscalYear: "2024",
    language: "ar",
  },
  session: null,
};

let state: StoreState = load();
const listeners = new Set<() => void>();

function load(): StoreState {
  if (typeof window === "undefined") return defaultState;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultState;
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return defaultState;
  }
}

function persist() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

export const erpStore = {
  get: () => state,
  set: (patch: Partial<StoreState>) => {
    state = { ...state, ...patch };
    persist();
  },
  reset: () => {
    state = defaultState;
    persist();
  },
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useErpStore<T>(selector: (s: StoreState) => T): T {
  return useSyncExternalStore(
    (cb) => erpStore.subscribe(cb),
    () => selector(erpStore.get()),
    () => selector(defaultState),
  );
}

// Business logic
export function computePO(po: PurchaseOrder) {
  const totalItems = po.rows.length;
  const totalQty = po.rows.reduce((s, r) => s + (r.qty || 0), 0);
  const totalPurchase = po.rows.reduce((s, r) => s + r.qty * r.price, 0);
  const totalCBM = po.rows.reduce((s, r) => {
    const cartons = r.pack ? r.qty / r.pack : 0;
    return s + cartons * r.cbm;
  }, 0);
  const totalCartons = po.rows.reduce(
    (s, r) => s + (r.pack ? r.qty / r.pack : 0),
    0,
  );
  const totalExpenses = po.expenses.reduce(
    (s, e) => s + e.amount * (e.rate || 1),
    0,
  );
  const cbmPrice = totalCBM > 0 ? totalExpenses / totalCBM : 0;
  const totalCost = totalPurchase + totalExpenses;

  const rowMetrics = po.rows.map((r) => {
    const cartons = r.pack ? r.qty / r.pack : 0;
    const linePurchase = r.qty * r.price;
    const lineCBM = cartons * r.cbm;
    let allocatedExp = 0;
    if (po.distributionType === "cbm" && totalCBM > 0)
      allocatedExp = (lineCBM / totalCBM) * totalExpenses;
    else if (po.distributionType === "value" && totalPurchase > 0)
      allocatedExp = (linePurchase / totalPurchase) * totalExpenses;
    else if (po.distributionType === "qty" && totalQty > 0)
      allocatedExp = (r.qty / totalQty) * totalExpenses;
    const cbmCost = r.qty ? allocatedExp / r.qty : 0;
    const avgCost = r.price + cbmCost;
    return { cartons, linePurchase, lineCBM, allocatedExp, cbmCost, avgCost };
  });

  return {
    totalItems,
    totalQty,
    totalPurchase,
    totalCBM,
    totalCartons,
    totalExpenses,
    cbmPrice,
    totalCost,
    rowMetrics,
  };
}

export function savePurchaseOrder(po: PurchaseOrder) {
  const s = erpStore.get();
  const existingIdx = s.purchaseOrders.findIndex((p) => p.number === po.number);
  const list = [...s.purchaseOrders];
  if (existingIdx >= 0) list[existingIdx] = po;
  else list.push(po);

  // Auto-create items
  const items = [...s.items];
  for (const row of po.rows) {
    if (!row.model) continue;
    let item = items.find((i) => i.code === row.model);
    if (!item) {
      item = {
        code: row.model,
        name: row.name,
        barcode: "",
        units: [{ name: row.unit, pack: row.pack, lastPrice: row.price }],
        cbmPerCarton: row.cbm,
        lastCost: 0,
      };
      items.push(item);
    } else if (po.approved) {
      const unit = item.units.find((u) => u.name === row.unit);
      if (unit) unit.lastPrice = row.price;
      else item.units.push({ name: row.unit, pack: row.pack, lastPrice: row.price });
      item.cbmPerCarton = row.cbm;
    }
  }
  if (po.approved) {
    const metrics = computePO(po);
    metrics.rowMetrics.forEach((m, i) => {
      const it = items.find((x) => x.code === po.rows[i].model);
      if (it) it.lastCost = m.avgCost;
    });
  }
  erpStore.set({ purchaseOrders: list, items });
}