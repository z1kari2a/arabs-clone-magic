import { useSyncExternalStore, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  hydrated: boolean;
};

const SETTINGS_KEY = "erp-settings-v1";

const defaultSettings: Settings = {
  companyName: "شركتي للتجارة العامة",
  defaultCurrency: "USD",
  fiscalYear: String(new Date().getFullYear()),
  language: "ar",
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
async function fetchSuppliers(): Promise<Supplier[]> {
  const { data } = await supabase.from("suppliers").select("*").order("code");
  return (data ?? []).map((r: any) => ({
    code: r.code, name: r.name, country: r.country ?? "", city: r.city ?? "",
    phone: r.phone ?? "", email: r.email ?? "", currency: r.currency, notes: r.notes ?? "", active: r.active,
  }));
}
async function fetchItems(): Promise<Item[]> {
  const { data } = await supabase.from("items").select("*").order("code");
  return (data ?? []).map((r: any) => ({
    code: r.code, name: r.name, barcode: r.barcode ?? "",
    units: Array.isArray(r.units) ? r.units : [],
    cbmPerCarton: Number(r.cbm_per_carton) || 0,
    lastCost: Number(r.last_cost) || 0,
  }));
}
async function fetchPOs(): Promise<PurchaseOrder[]> {
  const { data: pos } = await supabase.from("purchase_orders").select("*, po_rows(*), po_expenses(*), suppliers(code)").order("po_date", { ascending: false });
  return (pos ?? []).map((p: any) => ({
    number: p.number,
    date: p.po_date,
    invoiceNo: p.invoice_no ?? "",
    supplierCode: p.suppliers?.code ?? "",
    currency: p.currency,
    rate: Number(p.rate) || 1,
    containerNo: p.container_no ?? "",
    containerSize: p.container_size ?? "",
    distributionType: (p.distribution_type ?? "cbm") as any,
    notes: p.notes ?? "",
    approved: p.approved,
    rows: (p.po_rows ?? []).sort((a: any, b: any) => a.line_no - b.line_no).map((r: any) => ({
      id: r.line_no, model: r.model ?? "", name: r.name ?? "", unit: r.unit ?? "",
      pack: r.pack, qty: Number(r.qty), price: Number(r.price), cbm: Number(r.cbm),
    })),
    expenses: (p.po_expenses ?? []).sort((a: any, b: any) => a.line_no - b.line_no).map((e: any) => ({
      id: e.line_no, type: e.expense_type ?? "", note: e.note ?? "",
      currency: e.currency, amount: Number(e.amount), rate: Number(e.rate),
    })),
  }));
}
async function fetchUsers(): Promise<User[]> {
  const [{ data: profs }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name"),
    supabase.from("user_roles").select("user_id, role"),
  ]);
  const roleMap = new Map((roles ?? []).map((r: any) => [r.user_id, r.role]));
  return (profs ?? []).map((p: any) => ({
    id: p.id, username: p.email, fullName: p.full_name ?? p.email,
    role: (roleMap.get(p.id) ?? "viewer") as any, active: true,
  }));
}

export async function hydrateStore() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { setState({ hydrated: true }); return; }
  const [suppliers, items, purchaseOrders, users] = await Promise.all([
    fetchSuppliers(), fetchItems(), fetchPOs(), fetchUsers(),
  ]);
  setState({
    suppliers, items, purchaseOrders, users,
    session: { username: session.user.email ?? session.user.id },
    hydrated: true,
  });
}

export function useHydrate() {
  useEffect(() => { void hydrateStore(); }, []);
}

// ============ Mutations ============
export async function upsertSupplier(sup: Supplier) {
  const { error } = await supabase.from("suppliers").upsert({
    code: sup.code, name: sup.name, country: sup.country, city: sup.city,
    phone: sup.phone, email: sup.email, currency: sup.currency, notes: sup.notes, active: sup.active,
  }, { onConflict: "code" });
  if (error) throw error;
  setState({ suppliers: await fetchSuppliers() });
}
export async function deleteSupplier(code: string) {
  const { error } = await supabase.from("suppliers").delete().eq("code", code);
  if (error) throw error;
  setState({ suppliers: await fetchSuppliers() });
}

export async function upsertItem(it: Item) {
  const { error } = await supabase.from("items").upsert({
    code: it.code, name: it.name, barcode: it.barcode || null,
    units: it.units as any, cbm_per_carton: it.cbmPerCarton, last_cost: it.lastCost, active: true,
  }, { onConflict: "code" });
  if (error) throw error;
  setState({ items: await fetchItems() });
}
export async function deleteItem(code: string) {
  const { error } = await supabase.from("items").delete().eq("code", code);
  if (error) throw error;
  setState({ items: await fetchItems() });
}

export async function savePurchaseOrder(po: PurchaseOrder) {
  // resolve supplier id
  let supplierId: string | null = null;
  if (po.supplierCode) {
    const { data: s } = await supabase.from("suppliers").select("id").eq("code", po.supplierCode).maybeSingle();
    supplierId = s?.id ?? null;
  }
  const { data: existing } = await supabase.from("purchase_orders").select("id").eq("number", po.number).maybeSingle();
  const poPayload = {
    number: po.number, po_date: po.date, invoice_no: po.invoiceNo || null,
    supplier_id: supplierId, currency: po.currency, rate: po.rate,
    container_no: po.containerNo || null, container_size: po.containerSize || null,
    distribution_type: po.distributionType, notes: po.notes || null, approved: po.approved,
  };
  let poId = existing?.id;
  if (poId) {
    const { error } = await supabase.from("purchase_orders").update(poPayload).eq("id", poId);
    if (error) throw error;
    await supabase.from("po_rows").delete().eq("po_id", poId);
    await supabase.from("po_expenses").delete().eq("po_id", poId);
  } else {
    const { data, error } = await supabase.from("purchase_orders").insert(poPayload).select("id").single();
    if (error) throw error;
    poId = data.id;
  }
  const validRows = po.rows.filter((r) => r.model || r.name);
  if (validRows.length) {
    const { error } = await supabase.from("po_rows").insert(validRows.map((r, i) => ({
      po_id: poId, line_no: i + 1, model: r.model, name: r.name, unit: r.unit,
      pack: r.pack || 1, qty: r.qty, price: r.price, cbm: r.cbm,
    })));
    if (error) throw error;
  }
  if (po.expenses.length) {
    const { error } = await supabase.from("po_expenses").insert(po.expenses.map((e, i) => ({
      po_id: poId, line_no: i + 1, expense_type: e.type, note: e.note,
      currency: e.currency, amount: e.amount, rate: e.rate,
    })));
    if (error) throw error;
  }
  // Auto-create/update items
  for (const row of validRows) {
    if (!row.model) continue;
    const { data: existingItem } = await supabase.from("items").select("*").eq("code", row.model).maybeSingle();
    if (!existingItem) {
      await supabase.from("items").insert({
        code: row.model, name: row.name, units: [{ name: row.unit, pack: row.pack, lastPrice: row.price }] as any,
        cbm_per_carton: row.cbm, last_cost: 0, active: true,
      });
    } else if (po.approved) {
      const units = Array.isArray(existingItem.units) ? [...(existingItem.units as any[])] : [];
      const idx = units.findIndex((u: any) => u.name === row.unit);
      if (idx >= 0) units[idx] = { ...units[idx], lastPrice: row.price, pack: row.pack };
      else units.push({ name: row.unit, pack: row.pack, lastPrice: row.price });
      await supabase.from("items").update({ units: units as any, cbm_per_carton: row.cbm }).eq("id", existingItem.id);
    }
  }
  if (po.approved) {
    const metrics = computePO(po);
    for (let i = 0; i < validRows.length; i++) {
      const m = metrics.rowMetrics[i];
      if (!m) continue;
      await supabase.from("items").update({ last_cost: m.avgCost }).eq("code", validRows[i].model);
    }
  }
  setState({ purchaseOrders: await fetchPOs(), items: await fetchItems() });
}

export async function deletePO(number: string) {
  const { error } = await supabase.from("purchase_orders").delete().eq("number", number);
  if (error) throw error;
  setState({ purchaseOrders: await fetchPOs() });
}

// ============ Store API (compat with old code) ============
export const erpStore = {
  get: () => state,
  set: (patch: Partial<StoreState>) => {
    // Legacy setter: keep for settings + local mutations
    if (patch.suppliers) void patch.suppliers.forEach((s) => upsertSupplier(s));
    else if (patch.items) void patch.items.forEach((i) => upsertItem(i));
    else if (patch.purchaseOrders) {
      // Save each PO
      const prev = state.purchaseOrders;
      const changed = patch.purchaseOrders.filter((p) => !prev.find((x) => JSON.stringify(x) === JSON.stringify(p)));
      changed.forEach((p) => void savePurchaseOrder(p));
    } else {
      setState(patch);
    }
  },
  reset: () => {
    saveSettings(defaultSettings);
    setState({ settings: defaultSettings });
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
    const cbmCost = r.qty ? allocatedExp / r.qty : 0;
    const avgCost = r.price + cbmCost;
    return { cartons, linePurchase, lineCBM, allocatedExp, cbmCost, avgCost };
  });
  return { totalItems, totalQty, totalPurchase, totalCBM, totalCartons, totalExpenses, cbmPrice, totalCost, rowMetrics };
}

// Re-export savePurchaseOrder for old imports
export { savePurchaseOrder as savePO };
