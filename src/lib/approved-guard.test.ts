// الثابت المحاسبي: المستند المعتمَد لا يُعدَّل.
//
// أمر الشراء المعتمَد ليس مسودّة — تكلفة المخزون وأسعار البيع المحسوبة منه
// اعتُمدت عليه. تعديله بأثر رجعي يغيّر أرقاماً اتُّخذت بها قرارات، بلا أن يظهر
// شيء على الشاشة.
//
// كانت هذه القاعدة محفوظة في الواجهة وحدها (`disabled={po.approved}`)، أي
// بالحظّ: أي مستدعٍ آخر — استيراد، أو مزامنة، أو شاشة جديدة — يكتب فوقها
// بصمت. الاختبارات هنا تثبّتها في المكان الذي تُكتب فيه البيانات فعلاً.

import { beforeEach, describe, expect, it, vi } from "vitest";

// طبقة التخزين مُستبدَلة بمصفوفات في الذاكرة: المقصود اختبار قاعدة الحفظ، لا
// SQLite ولا localStorage. مرفوعة بـhoisted لأن vi.mock يسبق الواردات.
/** أقلّ ما يحتاجه المحاكي: مستند له رقم وحقول أخرى لا يفحصها. */
type StoredDoc = { number: string; approved?: boolean; notes?: string };

const db = vi.hoisted(() => ({
  orders: [] as StoredDoc[],
  requests: [] as StoredDoc[],
  audit: [] as Array<Record<string, unknown>>,
}));

vi.mock("./local-db", () => ({
  localDb: {
    purchaseOrders: {
      list: async () => db.orders,
      upsert: async (po: StoredDoc) => {
        const i = db.orders.findIndex((p) => p.number === po.number);
        if (i >= 0) db.orders[i] = po;
        else db.orders.push(po);
      },
      remove: async () => {},
    },
    purchaseRequests: {
      list: async () => db.requests,
      upsert: async (pr: StoredDoc) => {
        const i = db.requests.findIndex((p) => p.number === pr.number);
        if (i >= 0) db.requests[i] = pr;
        else db.requests.push(pr);
      },
      remove: async () => {},
    },
    items: { list: async () => [], upsert: async () => {}, upsertMany: async () => {} },
    suppliers: { list: async () => [], upsert: async () => {} },
  },
  logAudit: async (e: Record<string, unknown>) => void db.audit.push(e),
  getCurrentScope: () => "u1",
  writeWebStorage: () => {},
}));

import { ApprovedDocumentError, savePurchaseOrder, savePurchaseRequest } from "./erp-store";
import type { PurchaseOrder, PurchaseRequest } from "./erp-types";

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  number: "PO-1",
  date: "2026/08/17",
  invoiceNo: "INV-1",
  supplierCode: "S1",
  currency: "USD",
  rate: 1,
  containerNo: "",
  containerSize: "",
  distributionType: "cbm",
  notes: "",
  approved: false,
  rows: [{ id: 1, model: "M1", name: "صنف", unit: "كرتون", pack: 1, qty: 10, price: 5, cbm: 0.5 }],
  expenses: [],
  ...over,
});

const pr = (over: Partial<PurchaseRequest> = {}): PurchaseRequest =>
  ({
    number: "PR-1",
    date: "2026/08/17",
    invoiceNo: "INV-1",
    supplierCode: "S1",
    currency: "USD",
    rate: 1,
    notes: "",
    approved: false,
    rows: [
      { id: 1, model: "M1", name: "صنف", unit: "كرتون", pack: 1, qty: 10, price: 5, cbm: 0.5 },
    ],
    ...over,
  }) as PurchaseRequest;

beforeEach(() => {
  db.orders.length = 0;
  db.requests.length = 0;
  db.audit.length = 0;
});

describe("أمر الشراء المعتمَد", () => {
  it("يُحفظ الأمر غير المعتمَد بلا اعتراض", async () => {
    await savePurchaseOrder(po());
    expect(db.orders).toHaveLength(1);
  });

  // الاعتماد نفسه يمرّ من هنا: المخزَّن وقتها ما زال غير معتمَد.
  it("يسمح بفعل الاعتماد ذاته", async () => {
    await savePurchaseOrder(po());
    await savePurchaseOrder(po({ approved: true }));
    expect(db.orders[0].approved).toBe(true);
  });

  it("يرفض أي تعديل بعد الاعتماد", async () => {
    await savePurchaseOrder(po({ approved: true }));
    await expect(savePurchaseOrder(po({ approved: true, notes: "تعديل" }))).rejects.toThrow(
      ApprovedDocumentError,
    );
  });

  it("يرفض حتى محاولة إلغاء الاعتماد بالكتابة فوقه", async () => {
    await savePurchaseOrder(po({ approved: true }));
    await expect(savePurchaseOrder(po({ approved: false }))).rejects.toThrow(ApprovedDocumentError);
  });

  it("لا يكتب شيئاً حين يرفض — لا بيانات ولا قيد تدقيق", async () => {
    await savePurchaseOrder(po({ approved: true }));
    const auditBefore = db.audit.length;
    await expect(savePurchaseOrder(po({ approved: true, notes: "تعديل" }))).rejects.toThrow();
    expect(db.orders[0].notes).toBe("");
    expect(db.audit).toHaveLength(auditBefore);
  });

  it("يذكر رقم المستند في الخطأ ليعرف المستخدم أيّها", async () => {
    await savePurchaseOrder(po({ number: "PO-77", approved: true }));
    await expect(
      savePurchaseOrder(po({ number: "PO-77", approved: true, notes: "x" })),
    ).rejects.toMatchObject({ number: "PO-77" });
  });

  // مسار الاستعادة يُعيد إنتاج مستندات اعتُمدت في مكان آخر، لا يُعدّلها هنا.
  it("يسمح بالكتابة فوقه عند الاستعادة صراحةً", async () => {
    await savePurchaseOrder(po({ approved: true }));
    await savePurchaseOrder(po({ approved: true, notes: "من نسخة احتياطية" }), {
      overwriteApproved: true,
    });
    expect(db.orders[0].notes).toBe("من نسخة احتياطية");
  });

  it("لا يخلط بين أمرين: اعتماد أحدهما لا يقفل الآخر", async () => {
    await savePurchaseOrder(po({ number: "PO-1", approved: true }));
    await savePurchaseOrder(po({ number: "PO-2" }));
    await savePurchaseOrder(po({ number: "PO-2", notes: "مسودّة" }));
    expect(db.orders.find((o) => o.number === "PO-2")?.notes).toBe("مسودّة");
  });
});

describe("طلب الشراء المعتمَد", () => {
  it("يخضع لنفس القاعدة", async () => {
    await savePurchaseRequest(pr({ approved: true }));
    await expect(savePurchaseRequest(pr({ approved: true, notes: "تعديل" }))).rejects.toThrow(
      ApprovedDocumentError,
    );
  });

  it("يقبل الاستعادة صراحةً", async () => {
    await savePurchaseRequest(pr({ approved: true }));
    await savePurchaseRequest(pr({ approved: true, notes: "مستعاد" }), {
      overwriteApproved: true,
    });
    expect(db.requests[0].notes).toBe("مستعاد");
  });
});
