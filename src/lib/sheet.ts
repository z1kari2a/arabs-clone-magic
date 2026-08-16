// قراءة صفوف Excel المستوردة. SheetJS يعيد كل سطر كائناً مفاتيحه رؤوس الأعمدة
// كما كُتبت في الملف حرفياً — بمسافة زائدة أحياناً، وبالعربية أو بالإنجليزية
// حسب من أعدّ الملف. الدالتان هنا تستوعبان ذلك في مكان واحد بدل تكراره في كل
// شاشة استيراد.
import { parseDecimal } from "@/components/erp/ErpUI";

/**
 * قيمة أول عمود موجود وغير فارغ من بين المسميات المحتملة، أو undefined إن لم
 * يوجد أي منها. التمييز بين "عمود غائب" و"عمود فارغ" مقصود: الأول يعني «أبقِ
 * القيمة الحالية»، وليس «صفّرها».
 */
export function cell(row: Record<string, unknown>, ...names: string[]): unknown {
  const keys = Object.keys(row);
  for (const name of names) {
    // مطابقة متساهلة: تجاهل المسافات الطرفية وحالة الأحرف في رأس العمود.
    const key = keys.find((k) => k.trim().toLowerCase() === name.trim().toLowerCase());
    if (key === undefined) continue;
    const value = row[key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    return value;
  }
  return undefined;
}

// نص خلية يمكن قراءته رقماً: يبدأ برقم (لاتيني أو هندي أو فارسي) بعد إشارة
// اختيارية، ولا يحوي بعده إلا أرقاماً وفواصل ومسافات. كل ما عداه — «غير محدد»،
// «-»، «؟»، اسم صنف وقع في عمود الكمية — نصٌّ لا رقم.
const NUMERIC_TEXT = /^[-+]?[\d٠-٩۰-۹][\d٠-٩۰-۹\s.,،٫٬]*$/;

/**
 * رقم من خلية، مع الإبلاغ عمّا إذا كانت الخلية مكتوبة بما لا يُقرأ رقماً.
 *
 * `bad` هو الفرق بين «العمود غائب أو فارغ» و«العمود مكتوب فيه شيء لم نفهمه».
 * الأول حالة طبيعية تُرجِع القيمة الافتراضية بصمت؛ الثاني يجب أن يُقال للمستخدم،
 * لأن ابتلاعه صامتاً يعني فاتورة كاملة بأرقام خاطئة لا يشكّ فيها أحد.
 */
export function numCell(value: unknown, fallback: number): { value: number; bad: boolean } {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { value: fallback, bad: false };
  }
  // خلية رقمية في الملف نفسه: تُؤخذ كما هي، إلا أن تكون NaN/Infinity.
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value, bad: false } : { value: fallback, bad: true };
  }
  const text = String(value).trim();
  if (!NUMERIC_TEXT.test(text)) return { value: fallback, bad: true };
  return { value: parseDecimal(text), bad: false };
}

/** رقم من خلية، مع قيمة يُرجَع إليها حين يكون العمود غائباً أو فارغاً أو غير مقروء. */
export function num(value: unknown, fallback: number): number {
  return numCell(value, fallback).value;
}
