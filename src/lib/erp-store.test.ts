// اختبارات النواة الحسابية — أعلى ما في البرنامج قيمةً وأخطره على التغيير.
//
// القاعدة التي تحكم كل ما يلي: مهما اختلف أساس التوزيع (CBM أو نسبة أو متوسط)،
// فإن ما وُزِّع على الأسطر يجب أن يساوي إجمالي المصاريف بالضبط. هذه هي الخاصية
// التي تحمي التاجر من بيع بضاعة تحت تكلفتها الحقيقية، وهي ما تتحقّق منه معظم
// الاختبارات هنا بدل التحقق من أرقام مكتوبة يدوياً تفقد معناها عند أي تعديل.

import { beforeEach, describe, expect, it } from "vitest";
import {
  erpStore,
  computePO,
  computePR,
  isRealRow,
  cartonsOf,
  lineCBMOf,
  repinRates,
} from "./erp-store";
import type { PurchaseOrder, PurchaseRequest, PORow, Expense } from "./erp-types";

// ---------------------------------------------------------------- أدوات مساعدة

const CURRENCIES = [
  { code: "USD", name: "دولار", rate: 1 },
  { code: "YER", name: "ريال يمني", rate: 500 },
  { code: "CNY", name: "يوان", rate: 7 },
];

/** سطر بقيم افتراضية معقولة — الاختبار يذكر ما يهمّه فقط. */
const row = (over: Partial<PORow> = {}): PORow => ({
  id: 1,
  model: "M1",
  name: "صنف",
  unit: "كرتون",
  pack: 1,
  qty: 10,
  price: 5,
  cbm: 0.5,
  rate: 1,
  ...over,
});

const expense = (over: Partial<Expense> = {}): Expense =>
  ({ id: 1, type: "شحن", note: "", amount: 100, currency: "USD", rate: 1, ...over }) as Expense;

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  number: "INV-2026-00001",
  date: "2026/01/01",
  invoiceNo: "INV-2026-00001",
  supplierCode: "SUP0001",
  currency: "USD",
  rate: 1,
  containerNo: "",
  containerSize: "40 قدم HQ",
  distributionType: "cbm",
  notes: "",
  rows: [row()],
  expenses: [],
  approved: false,
  ...over,
});

const pr = (over: Partial<PurchaseRequest> = {}): PurchaseRequest => ({
  number: "REQ-2026-00001",
  date: "2026/01/01",
  invoiceNo: "REQ-2026-00001",
  supplierCode: "SUP0001",
  currency: "USD",
  rate: 1,
  containerNo: "",
  containerSize: "40 قدم HQ",
  distributionType: "cbm",
  cbmPrice: 0,
  expensePercentage: 0,
  notes: "",
  rows: [row()],
  approved: false,
  ...over,
});

/** مجموع ما وُزِّع فعلاً على الأسطر الحقيقية. */
const allocated = (doc: PurchaseOrder) =>
  computePO(doc).rowMetrics.reduce(
    (s, m, i) => (isRealRow(doc.rows[i]) ? s + m.allocatedExp : s),
    0,
  );

beforeEach(() => {
  // جدول العملات حالة عامة في المخزن — يُعاد ضبطه قبل كل اختبار حتى لا يسرّب
  // اختبارٌ سعرَ صرفٍ إلى الذي يليه.
  erpStore.set({
    settings: {
      companyName: "اختبار",
      defaultCurrency: "USD",
      fiscalYear: "2026",
      language: "ar",
      priceTiers: [],
      currencies: CURRENCIES,
      expenseTypes: [],
    },
  });
});

// ------------------------------------------------------------- أسطر ووحدات

describe("تمييز السطر الحقيقي من الفارغ", () => {
  it("سطر بموديل يُحتسب", () => {
    expect(isRealRow(row({ model: "M9", name: "", qty: 0 }))).toBe(true);
  });

  it("سطر باسم فقط يُحتسب", () => {
    expect(isRealRow(row({ model: "", name: "صنف", qty: 0 }))).toBe(true);
  });

  it("سطر بكمية فقط يُحتسب — وهو ما كان يُسعَّر على الشاشة ثم يُسقَط عند الحفظ", () => {
    expect(isRealRow(row({ model: "", name: "", qty: 3 }))).toBe(true);
  });

  it("السطر الفارغ تماماً لا يُحتسب", () => {
    expect(isRealRow(row({ model: "", name: "", qty: 0 }))).toBe(false);
  });
});

describe("الكمية والحجم", () => {
  it("الكمية هي عدد الطرود مباشرةً — العبوة لا تُقسَم عليها", () => {
    expect(cartonsOf(row({ qty: 50, pack: 12 }))).toBe(50);
  });

  it("إجمالي CBM = الكمية × حجم الطرد", () => {
    expect(lineCBMOf(row({ qty: 50, cbm: 0.1 }))).toBeCloseTo(5, 10);
  });

  it("كمية غير صالحة لا تُنتج NaN", () => {
    expect(cartonsOf(row({ qty: NaN }))).toBe(0);
    expect(lineCBMOf(row({ qty: 10, cbm: NaN }))).toBe(0);
  });
});

// ------------------------------------------------------------- أساس الاحتساب

describe("قاعدة الاحتساب (تحويل العملات والمجاميع)", () => {
  it("تكلفة الشراء = (سعر الحبة × العبوة) ÷ سعر الصرف", () => {
    const m = computePO(po({ rows: [row({ qty: 10, pack: 12, price: 5, rate: 1 })] }));
    // 10 طرود × (5 × 12) = 600 دولار
    expect(m.totalPurchase).toBeCloseTo(600, 10);
  });

  it("سطر بعملة أخرى يُحوَّل إلى الدولار بسعره المثبَّت", () => {
    const m = computePO(
      po({ rows: [row({ qty: 10, pack: 1, price: 1000, currency: "YER", rate: 500 })] }),
    );
    // 10 × 1000 ÷ 500 = 20 دولار
    expect(m.totalPurchase).toBeCloseTo(20, 10);
  });

  it("السطر بلا سعر مثبَّت يأخذ سعر الجدول الحيّ", () => {
    const m = computePO(
      po({ rows: [row({ qty: 1, pack: 1, price: 700, currency: "CNY", rate: 0 })] }),
    );
    expect(m.totalPurchase).toBeCloseTo(100, 10);
  });

  it("سعر صرف صفر يُعطي صفراً لا قسمةً على صفر", () => {
    const m = computePO(
      po({ rows: [row({ price: 5, currency: "XXX", rate: 0 })], currency: "XXX", rate: 0 }),
    );
    expect(Number.isFinite(m.totalPurchase)).toBe(true);
  });

  it("الأسطر الفارغة لا تدخل في عدد الأصناف ولا في المجاميع", () => {
    const m = computePO(
      po({ rows: [row({ id: 1 }), row({ id: 2, model: "", name: "", qty: 0, price: 0, cbm: 0 })] }),
    );
    expect(m.totalItems).toBe(1);
    expect(m.totalQty).toBe(10);
  });
});

// ------------------------------------------------------- توزيع المصاريف

describe("توزيع المصاريف — الخاصية الجوهرية", () => {
  const twoRows = [
    row({ id: 1, model: "A", qty: 10, price: 5, cbm: 0.5 }),
    row({ id: 2, model: "B", qty: 20, price: 3, cbm: 0.25 }),
  ];
  const expenses = [expense({ id: 1, amount: 200 }), expense({ id: 2, amount: 100 })];

  it("أساس CBM: مجموع الموزَّع = إجمالي المصاريف", () => {
    const doc = po({ rows: twoRows, expenses, distributionType: "cbm" });
    expect(allocated(doc)).toBeCloseTo(computePO(doc).totalExpenses, 8);
  });

  it("أساس النسبة: مجموع الموزَّع = إجمالي المصاريف", () => {
    const doc = po({ rows: twoRows, expenses, distributionType: "percentage" });
    expect(allocated(doc)).toBeCloseTo(computePO(doc).totalExpenses, 8);
  });

  it("أساس المتوسط: مجموع الموزَّع = إجمالي المصاريف", () => {
    const doc = po({ rows: twoRows, expenses, distributionType: "average" });
    expect(allocated(doc)).toBeCloseTo(computePO(doc).totalExpenses, 8);
  });

  it("سعر CBM = كل المصاريف ÷ إجمالي CBM", () => {
    const m = computePO(po({ rows: twoRows, expenses }));
    // CBM = 10×0.5 + 20×0.25 = 10 ؛ المصاريف = 300 ← 30 للمتر المكعب
    expect(m.totalCBM).toBeCloseTo(10, 10);
    expect(m.cbmPrice).toBeCloseTo(30, 10);
  });

  it("متوسط التكلفة هو فعلاً وسط الأساسين", () => {
    const m = computePO(po({ rows: twoRows, expenses, distributionType: "average" }));
    const r0 = m.rowMetrics[0];
    expect(r0.avgCost).toBeCloseTo((r0.cbmCost + r0.pctCost) / 2, 10);
    expect(r0.selectedCost).toBeCloseTo(r0.avgCost, 10);
  });

  it("التوزيع متوازن، وإجمالي التكلفة = الشراء + المصاريف", () => {
    const m = computePO(po({ rows: twoRows, expenses }));
    expect(m.allocationBalanced).toBe(true);
    expect(m.totalCost).toBeCloseTo(m.totalPurchase + m.totalExpenses, 8);
  });

  it("بلا أي CBM مُدخل يرجع التوزيع إلى الأساس النسبي بدل أن تختفي المصاريف", () => {
    const doc = po({
      rows: [row({ cbm: 0 }), row({ id: 2, model: "B", cbm: 0 })],
      expenses,
      distributionType: "cbm",
    });
    const m = computePO(doc);
    expect(m.cbmBasisUnusable).toBe(true);
    expect(allocated(doc)).toBeCloseTo(m.totalExpenses, 8);
    expect(allocated(doc)).toBeGreaterThan(0);
  });

  it("نسبة مكتوبة يدوياً تُحترم، والفرق عن المصاريف الحقيقية يُعلَن لا يُخفى", () => {
    const m = computePO(
      po({ rows: twoRows, expenses, distributionType: "percentage", expensePercentage: 5 }),
    );
    expect(m.pctRate).toBe(5);
    expect(m.allocationBalanced).toBe(false);
    expect(m.allocationDiff).not.toBe(0);
  });

  it("نسبة يدوية = صفر تعني صفراً فعلاً، لا «عُد إلى المقترحة»", () => {
    const m = computePO(po({ rows: twoRows, expenses, expensePercentage: 0 }));
    expect(m.pctRate).toBe(0);
  });

  it("مصروف بعملة أخرى يُحوَّل إلى الدولار", () => {
    const m = computePO(
      po({ rows: twoRows, expenses: [expense({ amount: 50000, currency: "YER", rate: 500 })] }),
    );
    expect(m.totalExpenses).toBeCloseTo(100, 10);
  });

  it("عمود «إجمالي أمر الشراء» يبقى بعملة الفاتورة لا بالدولار", () => {
    const m = computePO(
      po({ rows: [row({ qty: 10, pack: 2, price: 1000, currency: "YER", rate: 500 })] }),
    );
    // 10 × 1000 × 2 = 20000 ريالاً، لا 40 دولاراً
    expect(m.totalInvoiceAmount).toBeCloseTo(20000, 10);
  });
});

// ------------------------------------------------------------ حماية من NaN

describe("حماية الحساب من القيم غير الصالحة (انحدار: استيراد Excel)", () => {
  const bad = [
    row({ id: 1, model: "A", qty: 10, price: 5, cbm: 0.5 }),
    row({ id: 2, model: "B", qty: NaN, price: NaN, cbm: NaN, pack: NaN }),
  ];

  it("سطر واحد فاسد لا يُفسد أي مجموع", () => {
    const m = computePO(po({ rows: bad, expenses: [expense({ amount: 100 })] }));
    for (const [key, value] of Object.entries(m)) {
      if (typeof value === "number") {
        expect(Number.isFinite(value), `${key} = ${value}`).toBe(true);
      }
    }
  });

  it("السطر السليم يحتفظ بقيمته الصحيحة رغم فساد جاره", () => {
    const m = computePO(po({ rows: bad }));
    expect(m.totalPurchase).toBeCloseTo(50, 10);
    expect(m.totalCBM).toBeCloseTo(5, 10);
  });

  it("مصروف بمبلغ غير صالح يُهمَل ولا يمحو بقية المصاريف", () => {
    const m = computePO(
      po({ expenses: [expense({ id: 1, amount: NaN }), expense({ id: 2, amount: 100 })] }),
    );
    expect(m.totalExpenses).toBeCloseTo(100, 10);
  });

  it("نسبة مصاريف غير صالحة محفوظة على مستند قديم تعود إلى المقترحة", () => {
    const m = computePO(po({ expenses: [expense({ amount: 100 })], expensePercentage: NaN }));
    expect(Number.isFinite(m.pctRate)).toBe(true);
    expect(m.pctRate).toBeCloseTo(m.suggestedPct, 10);
  });

  it("كل تكاليف الأسطر تبقى أرقاماً صالحة", () => {
    const m = computePO(po({ rows: bad, expenses: [expense({ amount: 100 })] }));
    for (const rm of m.rowMetrics) {
      expect(Number.isFinite(rm.selectedCost)).toBe(true);
      expect(Number.isFinite(rm.allocatedExp)).toBe(true);
      expect(Number.isFinite(rm.lineTotalCost)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- طلب الشراء

describe("احتساب طلب الشراء", () => {
  it("مصاريفه تقديرية، فالتوزيع مطابق دائماً بلا فرق", () => {
    const m = computePR(pr({ cbmPrice: 30, rows: [row(), row({ id: 2, model: "B" })] }));
    expect(m.totalExpenses).toBeCloseTo(m.allocatedExpenses, 10);
    expect(m.totalCost).toBeCloseTo(m.totalPurchase + m.totalExpenses, 10);
  });

  it("سعر CBM المُدخل يدوياً هو ما يوزَّع به", () => {
    const m = computePR(pr({ cbmPrice: 30, rows: [row({ qty: 10, cbm: 0.5 })] }));
    // 10 × 0.5 × 30 = 150
    expect(m.totalExpenses).toBeCloseTo(150, 10);
  });

  it("نسبة المصاريف المُدخلة يدوياً توزّع نسبةً إلى قيمة الشراء", () => {
    const m = computePR(
      pr({
        distributionType: "percentage",
        expensePercentage: 10,
        rows: [row({ qty: 10, price: 5 })],
      }),
    );
    expect(m.totalExpenses).toBeCloseTo(5, 10); // 10% من 50
  });

  it("بلا CBM ومع سعر CBM مُدخل يرجع إلى الأساس النسبي", () => {
    const m = computePR(pr({ cbmPrice: 30, rows: [row({ cbm: 0 })] }));
    expect(m.cbmBasisUnusable).toBe(true);
  });

  it("طلب فارغ لا يُنتج NaN", () => {
    const m = computePR(pr({ rows: [] }));
    expect(m.totalCost).toBe(0);
    expect(m.totalItems).toBe(0);
  });
});

// ------------------------------------------------------------ تحديث الأسعار

describe("إعادة تثبيت أسعار الصرف", () => {
  it("تسحب السعر الحيّ إلى الرأس وكل الأسطر والمصروفات", () => {
    const before = po({
      currency: "YER",
      rate: 400,
      rows: [row({ currency: "YER", rate: 400 })],
      expenses: [expense({ currency: "YER", rate: 400 })],
    });
    const after = repinRates(before);
    expect(after.rate).toBe(500);
    expect(after.rows[0].rate).toBe(500);
    expect(after.expenses?.[0].rate).toBe(500);
  });

  it("عملة محذوفة من الجدول تُبقي سعرها المثبَّت بدل أن تُصفَّر", () => {
    const after = repinRates(
      po({ currency: "EUR", rate: 0.9, rows: [row({ currency: "EUR", rate: 0.9 })] }),
    );
    expect(after.rate).toBe(0.9);
    expect(after.rows[0].rate).toBe(0.9);
  });
});
