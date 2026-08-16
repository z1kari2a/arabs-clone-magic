// اختبارات قراءة ملفات Excel المستوردة.
//
// هنا يدخل كل رقم قادم من خارج البرنامج. الخطأ الذي تحرسه هذه الاختبارات:
// خلية نصية واحدة كانت تُنتج NaN يسري في كل الحسابات حتى مجاميع الفاتورة، ثم
// يُعرض «0.00» — فاتورة كاملة بأصفار لا يشكّ فيها أحد. والخطأ التوأم: رأس عمود
// فيه مسافة زائدة كان يفوت المطابقة فتُستورد أصفار في كل الأسطر بصمت.

import { describe, expect, it } from "vitest";
import { cell, num, numCell } from "./sheet";
import { parseDecimal } from "@/components/erp/ErpUI";

describe("مطابقة رؤوس الأعمدة", () => {
  it("تتجاهل المسافات الطرفية في رأس العمود", () => {
    expect(cell({ "الكمية ": 5 }, "الكمية")).toBe(5);
  });

  it("تتجاهل حالة الأحرف", () => {
    expect(cell({ QTY: 7 }, "qty")).toBe(7);
  });

  it("تأخذ أول مسمّى موجود بالترتيب المذكور", () => {
    expect(cell({ CBM: 1, "CBM الكرتون": 2 }, "CBM الكرتون", "CBM")).toBe(2);
  });

  it("تتخطى العمود الفارغ إلى المسمّى التالي", () => {
    expect(cell({ الكمية: "   ", qty: 9 }, "الكمية", "qty")).toBe(9);
  });

  it("تُعيد undefined حين لا يوجد أي مسمّى — أي «أبقِ القيمة الحالية»", () => {
    expect(cell({ "اسم الصنف": "س" }, "الكمية", "qty")).toBeUndefined();
  });
});

describe("قراءة الخلايا الرقمية", () => {
  it("الرقم في الملف يُؤخذ كما هو", () => {
    expect(numCell(12.5, 0)).toEqual({ value: 12.5, bad: false });
  });

  it("النص الرقمي يُقرأ", () => {
    expect(numCell("12.5", 0)).toEqual({ value: 12.5, bad: false });
  });

  it("الأرقام الهندية تُقرأ", () => {
    expect(numCell("٢٥", 0)).toEqual({ value: 25, bad: false });
  });

  it("الفاصلة العشرية العربية تُقرأ", () => {
    expect(numCell("٣٫٥", 0).value).toBeCloseTo(3.5, 10);
  });

  it("فاصل الآلاف لا يُخلط بالفاصلة العشرية", () => {
    expect(numCell("2,680.45", 0).value).toBeCloseTo(2680.45, 10);
  });

  it("العمود الغائب يُعيد القيمة الافتراضية بلا شكوى", () => {
    expect(numCell(undefined, 3)).toEqual({ value: 3, bad: false });
  });

  it("العمود الفارغ يُعيد القيمة الافتراضية بلا شكوى", () => {
    expect(numCell("   ", 3)).toEqual({ value: 3, bad: false });
  });

  it("نص غير رقمي يُبلَّغ عنه ولا يُنتج NaN", () => {
    expect(numCell("غير محدد", 0)).toEqual({ value: 0, bad: true });
  });

  it("الشرطة المفردة نص لا رقم", () => {
    expect(numCell("-", 1)).toEqual({ value: 1, bad: true });
  });

  it("اسم صنف وقع في عمود الكمية يُبلَّغ عنه", () => {
    expect(numCell("كرتون كبير", 0).bad).toBe(true);
  });

  it("NaN رقمياً في الملف يُبلَّغ عنه", () => {
    expect(numCell(NaN, 5)).toEqual({ value: 5, bad: true });
  });

  it("قيمة موجبة صريحة الإشارة تُقرأ", () => {
    expect(numCell("+8", 0)).toEqual({ value: 8, bad: false });
  });

  it("num يعيد القيمة وحدها ولا يُنتج NaN أبداً", () => {
    expect(num("خطأ", 4)).toBe(4);
    expect(Number.isFinite(num("خطأ", 0))).toBe(true);
  });
});

describe("تحليل الأرقام المكتوبة يدوياً", () => {
  it("الفاصلة كفاصلة عشرية", () => {
    expect(parseDecimal("1,5")).toBeCloseTo(1.5, 10);
  });

  it("الأرقام الفارسية", () => {
    expect(parseDecimal("۴۲")).toBe(42);
  });

  it("فاصل الآلاف العربي يُحذف", () => {
    expect(parseDecimal("١٬٢٣٤")).toBe(1234);
  });

  it("القيمة السالبة", () => {
    expect(parseDecimal("-7.25")).toBeCloseTo(-7.25, 10);
  });

  it("النص الفارغ صفر", () => {
    expect(parseDecimal("")).toBe(0);
  });

  it("النص غير الرقمي صفر لا NaN", () => {
    expect(parseDecimal("abc")).toBe(0);
  });
});
