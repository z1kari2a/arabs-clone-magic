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

/** رقم من خلية، مع قيمة يُرجَع إليها حين يكون العمود غائباً أو فارغاً. */
export function num(value: unknown, fallback: number): number {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return parseDecimal(typeof value === "number" ? value : String(value));
}
