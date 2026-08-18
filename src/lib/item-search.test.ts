// اختبارات البحث في دليل الأصناف وسجلّ شراء الوحدات. الحالات المختارة هي ما
// طلبه التاجر حرفياً: يكتب ٧٢٠ فيجد 720، ويكتب جزءاً من الاسم فيجد كل ما يحتويه،
// ولا يدخل صنفٌ غير الذي قصده.
import { describe, it, expect } from "vitest";
import {
  normalizeSearch,
  itemMatches,
  exactItem,
  sortItems,
  collectUnitPurchases,
} from "./item-search";
import type { Item, PurchaseOrder, Supplier } from "./erp-types";

const item = (
  code: string,
  name: string,
  barcode = "",
  units = [{ name: "حبة", pack: 1, lastPrice: 0 }],
): Item => ({
  code,
  name,
  barcode,
  units,
  cbmPerCarton: 0,
  lastCost: 0,
});

const items = [
  item("720", "مروحة سقف 720"),
  item("7201", "مروحة جدارية"),
  item("A-720-B", "خلاط كهربائي", "6291720"),
  item("100", "غلاية ماء"),
];

describe("normalizeSearch", () => {
  it("يحوّل الأرقام العربية‑الهندية إلى لاتينية", () => {
    expect(normalizeSearch("٧٢٠")).toBe("720");
    expect(normalizeSearch("۷۲۰")).toBe("720");
  });
  it("يوحّد أشكال الألف والياء والهاء ويُسقط التشكيل", () => {
    expect(normalizeSearch("أحمد")).toBe(normalizeSearch("احمد"));
    expect(normalizeSearch("مروحةٌ")).toBe(normalizeSearch("مروحه"));
  });
});

describe("itemMatches", () => {
  it("يجد كل صنف يحتوي الرقم في موديله أو اسمه أو باركوده", () => {
    const hits = items.filter((it) => itemMatches(it, "720")).map((it) => it.code);
    expect(hits).toEqual(["720", "7201", "A-720-B"]);
  });
  it("يجد نفس النتائج إذا كُتب الرقم بالعربية‑الهندية", () => {
    const arabic = items.filter((it) => itemMatches(it, "٧٢٠")).map((it) => it.code);
    const latin = items.filter((it) => itemMatches(it, "720")).map((it) => it.code);
    expect(arabic).toEqual(latin);
  });
  it("يبحث في جزء من اسم الصنف", () => {
    expect(items.filter((it) => itemMatches(it, "مروح")).map((it) => it.code)).toEqual([
      "720",
      "7201",
    ]);
  });
  it("نصّ فارغ لا يُقصي شيئاً", () => {
    expect(items.every((it) => itemMatches(it, "   "))).toBe(true);
  });
});

describe("exactItem", () => {
  it("لا يُرجِع شيئاً لتطابق جزئي — لئلا يدخل صنف غير المقصود أثناء الكتابة", () => {
    expect(exactItem(items, "72")).toBeUndefined();
    expect(exactItem(items, "مروحة")).toBeUndefined();
  });
  it("يُرجِع الصنف عند تطابق الموديل أو الباركود أو الاسم كاملاً", () => {
    expect(exactItem(items, "720")?.code).toBe("720");
    expect(exactItem(items, "6291720")?.code).toBe("A-720-B");
    expect(exactItem(items, "غلاية ماء")?.code).toBe("100");
  });
  it("يقبل الرقم مكتوباً بالعربية‑الهندية", () => {
    expect(exactItem(items, "٧٢٠")?.code).toBe("720");
  });
});

describe("sortItems", () => {
  it("يرتّب حسب الرقم ترتيباً رقمياً لا حرفياً", () => {
    const list = [item("100", "ج"), item("20", "ب"), item("3", "أ")];
    expect(sortItems(list, "code").map((i) => i.code)).toEqual(["3", "20", "100"]);
  });
  it("يرتّب حسب الاسم", () => {
    expect(sortItems(items, "name")[0].name).toBe("خلاط كهربائي");
  });
});

describe("collectUnitPurchases", () => {
  const suppliers: Supplier[] = [
    {
      code: "S1",
      name: "مورد الصين",
      country: "الصين",
      city: "",
      phone: "",
      email: "",
      currency: "CNY",
      notes: "",
      active: true,
    },
  ];
  const order = (number: string, date: string, rows: { unit: string; price: number }[]) =>
    ({
      number,
      date,
      invoiceNo: number,
      supplierCode: "S1",
      currency: "USD",
      rate: 1,
      containerNo: "",
      containerSize: "",
      distributionType: "cbm",
      notes: "",
      expenses: [],
      approved: true,
      rows: rows.map((r, i) => ({
        id: i + 1,
        model: "720",
        name: "مروحة سقف 720",
        unit: r.unit,
        pack: 1,
        qty: 10,
        price: r.price,
        cbm: 0,
      })),
    }) as PurchaseOrder;

  const orders = [
    order("INV-1", "2026/01/10", [{ unit: "كرتون", price: 12 }]),
    order("INV-2", "2026/03/05", [
      { unit: "كرتون", price: 14 },
      { unit: "حبة", price: 2 },
    ]),
  ];

  it("يعدّ مرات الشراء لكل وحدة ويحفظ سعر كل عملية ومورّدها", () => {
    const units = collectUnitPurchases(orders, suppliers, items);
    const carton = units.find((u) => u.unit === "كرتون")!;
    expect(carton.purchases).toHaveLength(2);
    expect(carton.purchases.map((p) => p.price)).toEqual([14, 12]); // الأحدث أولاً
    expect(carton.purchases.every((p) => p.supplier === "مورد الصين")).toBe(true);
  });

  it("يُدرِج وحدات الدليل التي لم تُشترَ بعد بعدد صفر", () => {
    const units = collectUnitPurchases([], suppliers, [
      item("50", "صنف", "", [{ name: "طقم", pack: 6, lastPrice: 0 }]),
    ]);
    expect(units).toEqual([{ unit: "طقم", purchases: [] }]);
  });

  it("يعرض رمز المورد حين لا يوجد مورد بهذا الرمز في الجدول", () => {
    const units = collectUnitPurchases(orders, [], items);
    expect(units[0].purchases[0].supplier).toBe("S1");
  });
});
