// دوالّ البحث في دليل الأصناف وسجلّ شراء الوحدات — صافية بلا واجهة، فتُختبر
// وحدها (src/lib/item-search.test.ts) وتُستعمل من شاشات البنود والدليل معاً.
import type { Item, PurchaseOrder, Supplier } from "./erp-types";

/**
 * توحيد النص قبل المقارنة حتى يجد البحثُ ما يقصده المستخدم لا ما كتبه حرفياً:
 * الأرقام العربية‑الهندية (٧٢٠) تساوي اللاتينية (720)، وأشكال الألف والهاء
 * المربوطة والياء تتساوى، والتشكيل والتطويل يسقطان. بدون هذا يكتب التاجر ٧٢٠
 * فلا يجد الصنف 720 الموجود أمامه في الجدول.
 */
export function normalizeSearch(v: string): string {
  return String(v ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .trim()
    .toLowerCase();
}

/** هل يحتوي الصنف على النص المكتوب في رقمه أو اسمه أو باركوده؟ */
export function itemMatches(it: Item, term: string): boolean {
  const t = normalizeSearch(term);
  if (!t) return true;
  return (
    normalizeSearch(it.code).includes(t) ||
    normalizeSearch(it.name).includes(t) ||
    normalizeSearch(it.barcode).includes(t)
  );
}

/**
 * الصنف المطابق تماماً لما كُتب — رقم موديل أو باركود أو اسم كامل.
 * هذا وحده ما يجوز أن يُملأ في السطر تلقائياً؛ أي تطابق جزئي يُعرض في قائمة
 * ليختار المستخدم منها، فلا «يدخل صنف آخر» غير الذي قصده.
 */
export function exactItem(items: Item[], term: string): Item | undefined {
  const t = normalizeSearch(term);
  if (!t) return undefined;
  return items.find(
    (it) =>
      normalizeSearch(it.code) === t ||
      normalizeSearch(it.barcode) === t ||
      normalizeSearch(it.name) === t,
  );
}

/** ترتيب الأصناف حسب الرقم (رقمياً لا حرفياً) أو حسب الاسم بترتيب عربي. */
export function sortItems(list: Item[], by: "code" | "name"): Item[] {
  const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });
  return [...list].sort((a, b) =>
    by === "code" ? collator.compare(a.code, b.code) : collator.compare(a.name, b.name),
  );
}

export type UnitPurchase = {
  unit: string;
  orderNo: string;
  date: string;
  supplier: string;
  model: string;
  itemName: string;
  qty: number;
  pack: number;
  price: number;
  currency: string;
};

/**
 * سجلّ شراء كل وحدة، مستخرَجاً من أوامر الشراء المحفوظة: كل سطر فيه وحدة هو
 * عملية شراء بسعرها ومورّدها وتاريخها. الوحدات المسجّلة في دليل الأصناف ولم
 * تُشترَ بعد تظهر أيضاً بعدد صفر — «الوحدات المسجّلة بالنظام» تعني كلّها.
 */
export function collectUnitPurchases(
  orders: PurchaseOrder[],
  suppliers: Supplier[],
  items: Item[],
): { unit: string; purchases: UnitPurchase[] }[] {
  const supplierName = (code: string) =>
    suppliers.find((s) => s.code === code)?.name || code || "—";
  const itemName = (model: string, fallback: string) =>
    fallback || items.find((i) => i.code === model)?.name || "";

  const byUnit = new Map<string, UnitPurchase[]>();
  const ensure = (unit: string) => {
    const key = unit.trim();
    if (!key) return null;
    if (!byUnit.has(key)) byUnit.set(key, []);
    return byUnit.get(key)!;
  };

  for (const it of items) for (const u of it.units) ensure(u.name);

  for (const o of orders) {
    for (const r of o.rows) {
      const bucket = ensure(r.unit);
      if (!bucket) continue;
      bucket.push({
        unit: r.unit.trim(),
        orderNo: o.number,
        date: o.date,
        supplier: supplierName(o.supplierCode),
        model: r.model,
        itemName: itemName(r.model, r.name),
        qty: r.qty,
        pack: r.pack,
        price: r.price,
        currency: r.currency ?? o.currency,
      });
    }
  }

  return [...byUnit.entries()]
    .map(([unit, purchases]) => ({
      unit,
      // الأحدث أولاً — آخر شراء هو ما يهم التاجر أولاً.
      purchases: [...purchases].sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .sort((a, b) => b.purchases.length - a.purchases.length || a.unit.localeCompare(b.unit, "ar"));
}
