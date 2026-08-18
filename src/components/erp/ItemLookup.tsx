import { useEffect, useMemo, useRef, useState } from "react";
import { Package, Ruler, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Item, PurchaseOrder, Supplier } from "@/lib/erp-types";
import { collectUnitPurchases, itemMatches, sortItems } from "@/lib/item-search";
import { fmt, fmtAuto } from "./ErpUI";

/**
 * خانة جدول تبحث في دليل الأصناف: Enter يفتح قائمة بكل ما يحتوي المكتوب،
 * وF9 يفتح القائمة كاملة مرتّبة. لا `select()` عند التركيز ولا مفتاح React
 * متغيّر حولها، حتى يبقى التظليل بالماوس داخل الخانة ممكناً لإضافة رقم أو
 * حذفه من موديل مكتوب.
 */
export function LookupInput({
  value,
  onChange,
  disabled,
  align = "center",
  inputClass = "",
  onEnter,
  onF9,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  align?: "right" | "left" | "center";
  inputClass?: string;
  /** يُعيد true إذا التقط Enter (فتح قائمة أو ملأ صنفاً) فلا ينتقل المؤشر للسطر التالي. */
  onEnter?: () => boolean;
  onF9?: () => void;
  title?: string;
}) {
  return (
    <input
      value={value}
      disabled={disabled}
      title={title}
      /* وسمٌ تقرأه اختصارات الشاشة لتعرف أن F9 هنا يعني «أظهر القائمة» لا
         «اعتمِد المستند»: معالج الشاشة يلتقط المفاتيح قبل React، فلا يكفيه
         stopPropagation الصادر من هذه الخانة. */
      data-lookup-cell=""
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "F9") {
          // يجب أن يتوقّف الحدث هنا: F9 على مستوى الشاشة يعني «اعتماد»،
          // وداخل هذه الخانة يعني «أظهر القائمة».
          e.preventDefault();
          e.stopPropagation();
          onF9?.();
          return;
        }
        if (e.key === "Enter" && onEnter) {
          if (onEnter()) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }}
      className={`w-full px-1 py-1 bg-white disabled:bg-slate-50 border-0 focus:outline-none text-${align} ${inputClass}`}
    />
  );
}

/**
 * قائمة الأصناف: كل ما يحتوي النص المكتوب في الرقم أو الاسم أو الباركود،
 * مرتّباً حسب الرقم أو حسب الاسم بحسب الخانة التي فُتحت منها.
 */
export function ItemsLookupDialog({
  open,
  onOpenChange,
  items,
  initialTerm = "",
  sortBy,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: Item[];
  initialTerm?: string;
  sortBy: "code" | "name";
  onPick: (it: Item) => void;
}) {
  const [term, setTerm] = useState(initialTerm);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setTerm(initialTerm);
      setSel(0);
    }
  }, [open, initialTerm]);

  const rows = useMemo(
    () =>
      sortItems(
        items.filter((it) => itemMatches(it, term)),
        sortBy,
      ),
    [items, term, sortBy],
  );

  // إبقاء السطر المختار داخل مجال الرؤية أثناء التنقّل بالأسهم.
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const pick = (it: Item | undefined) => {
    if (!it) return;
    onPick(it);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-7">
            <Package size={16} className="text-emerald-600" />
            {sortBy === "code" ? "الأصناف مرتّبة حسب رقم الموديل" : "الأصناف مرتّبة حسب اسم الصنف"}
            <span className="text-xs font-normal text-slate-500">({rows.length})</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            autoFocus
            value={term}
            placeholder="اكتب جزءاً من الرقم أو الاسم أو الباركود..."
            onChange={(e) => {
              setTerm(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                pick(rows[sel]);
              }
            }}
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded text-right"
          />
        </div>

        <div ref={listRef} className="max-h-[55vh] overflow-auto border border-slate-200 rounded">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0">
              <tr
                style={{ background: "var(--color-erp-table-header)" }}
                className="text-slate-700"
              >
                {["م", "الموديل", "اسم الصنف", "الباركود", "الوحدة", "العبوة", "آخر سعر"].map(
                  (h) => (
                    <th key={h} className="border border-slate-300 px-2 py-1 font-semibold">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((it, i) => (
                <tr
                  key={it.code}
                  data-row={i}
                  onClick={() => pick(it)}
                  onMouseEnter={() => setSel(i)}
                  className={`cursor-pointer ${i === sel ? "bg-blue-100" : "hover:bg-blue-50/60"}`}
                >
                  <td className="border border-slate-200 text-center text-slate-500">{i + 1}</td>
                  <td className="border border-slate-200 text-center font-semibold tabular-nums">
                    {it.code}
                  </td>
                  <td className="border border-slate-200 px-2 text-right font-semibold">
                    {it.name}
                  </td>
                  <td className="border border-slate-200 text-center text-slate-500">
                    {it.barcode}
                  </td>
                  <td className="border border-slate-200 text-center">{it.units[0]?.name ?? ""}</td>
                  <td className="border border-slate-200 text-center">{it.units[0]?.pack ?? ""}</td>
                  <td className="border border-slate-200 px-2 text-left tabular-nums">
                    {fmtAuto(it.units[0]?.lastPrice ?? 0, 4)} {it.currency ?? ""}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    لا يوجد صنف يحتوي «{term}»
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="text-[10px] text-slate-500">↑↓ للتنقّل • Enter للاختيار • Esc للإغلاق</div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * قائمة الوحدات المسجّلة بالنظام: لكل وحدة عدد مرات الشراء، والموردون الذين
 * اشتُريت منهم، وسعر كل عملية شراء — يُفتح بـ F9 من خانة «الوحدة».
 */
export function UnitsLookupDialog({
  open,
  onOpenChange,
  items,
  orders,
  suppliers,
  model = "",
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: Item[];
  orders: PurchaseOrder[];
  suppliers: Supplier[];
  /** موديل السطر الذي فُتحت منه القائمة — يسمح بحصر السجل على هذا الصنف. */
  model?: string;
  onPick: (unit: string) => void;
}) {
  const [thisItemOnly, setThisItemOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setThisItemOnly(Boolean(model));
      setExpanded(null);
    }
  }, [open, model]);

  const all = useMemo(
    () => collectUnitPurchases(orders, suppliers, items),
    [orders, suppliers, items],
  );
  const rows = useMemo(() => {
    if (!thisItemOnly || !model) return all;
    return all
      .map((u) => ({ ...u, purchases: u.purchases.filter((p) => p.model === model) }))
      .filter((u) => u.purchases.length);
  }, [all, thisItemOnly, model]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-7">
            <Ruler size={16} className="text-blue-600" />
            الوحدات المسجّلة بالنظام
            <span className="text-xs font-normal text-slate-500">({rows.length})</span>
          </DialogTitle>
        </DialogHeader>

        {Boolean(model) && (
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={thisItemOnly}
              onChange={(e) => setThisItemOnly(e.target.checked)}
            />
            عمليات شراء الصنف «{model}» فقط
          </label>
        )}

        <div className="max-h-[55vh] overflow-auto border border-slate-200 rounded">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0">
              <tr
                style={{ background: "var(--color-erp-table-header)" }}
                className="text-slate-700"
              >
                {["الوحدة", "مرات الشراء", "الموردون", "آخر سعر", ""].map((h, i) => (
                  <th key={i} className="border border-slate-300 px-2 py-1 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const last = u.purchases[0];
                const sups = [...new Set(u.purchases.map((p) => p.supplier))];
                const isOpen = expanded === u.unit;
                return [
                  <tr key={u.unit} className="hover:bg-blue-50/60">
                    <td
                      className="border border-slate-200 px-2 text-center font-semibold cursor-pointer"
                      onClick={() => {
                        onPick(u.unit);
                        onOpenChange(false);
                      }}
                      title="اختيار هذه الوحدة"
                    >
                      {u.unit}
                    </td>
                    <td className="border border-slate-200 text-center tabular-nums">
                      {u.purchases.length}
                    </td>
                    <td className="border border-slate-200 px-2 text-right">
                      {sups.length ? sups.join("، ") : "— لم تُشترَ بعد"}
                    </td>
                    <td className="border border-slate-200 px-2 text-left tabular-nums">
                      {last ? `${fmtAuto(last.price, 4)} ${last.currency}` : "—"}
                    </td>
                    <td className="border border-slate-200 text-center">
                      <button
                        type="button"
                        disabled={!u.purchases.length}
                        onClick={() => setExpanded(isOpen ? null : u.unit)}
                        className="px-2 py-0.5 text-[11px] border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-30"
                      >
                        {isOpen ? "إخفاء" : "التفاصيل"}
                      </button>
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={u.unit + ":d"}>
                      <td colSpan={5} className="border border-slate-200 bg-slate-50 p-2">
                        <table className="w-full border-collapse text-[11px]">
                          <thead>
                            <tr className="text-slate-600">
                              {["التاريخ", "أمر الشراء", "المورد", "الصنف", "الكمية", "السعر"].map(
                                (h) => (
                                  <th
                                    key={h}
                                    className="border border-slate-200 px-1 py-0.5 font-semibold"
                                  >
                                    {h}
                                  </th>
                                ),
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {u.purchases.map((p, i) => (
                              <tr key={p.orderNo + i} className="bg-white">
                                <td className="border border-slate-200 text-center">{p.date}</td>
                                <td className="border border-slate-200 text-center">{p.orderNo}</td>
                                <td className="border border-slate-200 px-1 text-right">
                                  {p.supplier}
                                </td>
                                <td className="border border-slate-200 px-1 text-right">
                                  {p.model} {p.itemName && `— ${p.itemName}`}
                                </td>
                                <td className="border border-slate-200 text-center tabular-nums">
                                  {fmt(p.qty, 0)}
                                </td>
                                <td className="border border-slate-200 px-1 text-left tabular-nums font-semibold">
                                  {fmtAuto(p.price, 4)} {p.currency}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    لا توجد وحدات مسجّلة بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="text-[10px] text-slate-500">
          اضغط على اسم الوحدة لاختيارها • «التفاصيل» يعرض كل عملية شراء بسعرها ومورّدها
        </div>
      </DialogContent>
    </Dialog>
  );
}
