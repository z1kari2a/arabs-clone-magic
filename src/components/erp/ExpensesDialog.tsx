import { useMemo, useState } from "react";
import { Plus, Trash2, X, RefreshCw, Check, Wallet } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Expense, Currency } from "@/lib/erp-types";
import { fmt, parseDecimal, useNumericBuffer } from "./ErpUI";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expenses: Expense[];
  invoiceCurrency: string;
  currencies: Currency[];
  expenseTypes: string[];
  onSave: (rows: Expense[]) => void;
  onSaveExpenseTypes?: (types: string[]) => void;
  onRefreshRates?: () => void;
  disabled?: boolean;
  title?: string;
};

export default function ExpensesDialog({
  open,
  onOpenChange,
  expenses,
  invoiceCurrency,
  currencies,
  expenseTypes,
  onSave,
  onSaveExpenseTypes,
  onRefreshRates,
  disabled,
  title = "مصروفات أمر الشراء",
}: Props) {
  const [rows, setRows] = useState<Expense[]>(expenses);
  const [types, setTypes] = useState<string[]>(expenseTypes);
  const [newType, setNewType] = useState("");
  const [showTypes, setShowTypes] = useState(false);

  // Reset when reopened
  useMemo(() => { if (open) { setRows(expenses); setTypes(expenseTypes); } }, [open]); // eslint-disable-line

  const rateOf = (code: string) => currencies.find((c) => c.code === code)?.rate ?? 0;
  // Base currency = USD, same convention as the "أسعار الصرف" screen: `rate` =
  // how many units of the currency equal 1 USD (e.g. YER = 536). Expenses always
  // convert straight to USD — never to invoice/vendor currency — so the total here
  // is the single reference figure distributed across items in the PO screen.
  // This edits the rate PINNED on this row only — it must not overwrite the
  // global currency table (that's what /rates is for; see savePurchaseOrder,
  // which pins rates so historical documents never shift under a later edit).
  const setRowRate = (id: number, rate: number) => {
    if (!(rate > 0)) return;
    setRows(rows.map((r) => (r.id === id ? { ...r, rate } : r)));
  };
  const convert = (amt: number, rate: number) => (rate > 0 ? amt / rate : 0);
  const total = rows.reduce((s, e) => s + convert(e.amount, e.rate), 0);

  const nextId = () => (rows.at(-1)?.id ?? 0) + 1;

  const addRow = () =>
    setRows([...rows, {
      id: nextId(), type: "", note: "", currency: invoiceCurrency,
      amount: 0, rate: rateOf(invoiceCurrency),
    }]);

  const patch = (id: number, p: Partial<Expense>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const remove = (id: number) => setRows(rows.filter((r) => r.id !== id));

  const refreshRates = () => {
    setRows(rows.map((r) => ({ ...r, rate: rateOf(r.currency) })));
    onRefreshRates?.();
    toast.success("تم تحديث أسعار الصرف");
  };

  const save = () => {
    const clean = rows.filter((r) => r.amount > 0 || r.type);
    for (const r of clean) {
      if (!r.currency || !currencies.some((c) => c.code === r.currency)) {
        return toast.error(`العملة "${r.currency || "—"}" غير معرّفة في أسعار الصرف`);
      }
      if (!(r.rate > 0)) {
        return toast.error(`سعر صرف غير صالح للعملة ${r.currency}`);
      }
    }
    onSave(clean);
    if (onSaveExpenseTypes) onSaveExpenseTypes(types);
    onOpenChange(false);
    toast.success("تم حفظ المصروفات");
  };

  const addType = () => {
    const t = newType.trim();
    if (!t) return;
    if (types.includes(t)) return toast.error("النوع موجود");
    setTypes([...types, t]);
    setNewType("");
  };
  const removeType = (t: string) => setTypes(types.filter((x) => x !== t));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-5xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-white">
          <button onClick={() => onOpenChange(false)} className="text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded p-1">
            <X size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Wallet className="text-blue-600" size={20} />
            <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          </div>
        </div>

        {/* Summary strip */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-50/50 border-b border-slate-200">
          <div className="text-right">
            <div className="text-[11px] text-slate-500 mb-0.5">إجمالي المصروفات بالدولار</div>
            <div className="text-2xl font-bold text-emerald-600">
              {fmt(total)} <span className="text-sm text-slate-500 font-medium">USD</span>
            </div>
          </div>
          <div className="text-left">
            <div className="text-[11px] text-slate-500 mb-0.5">عملة الاحتساب</div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-md">
              <span className="font-bold text-slate-800">USD</span>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="px-5 py-3 max-h-[55vh] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[12px] text-slate-500 border-b border-slate-200">
                <th className="text-right py-2 px-2 font-medium">البيان</th>
                <th className="text-right py-2 px-2 font-medium">العملة</th>
                <th className="text-right py-2 px-2 font-medium">المبلغ</th>
                <th className="text-right py-2 px-2 font-medium">
                  سعر الصرف <span dir="ltr" className="inline-block">(1 USD =)</span>
                </th>
                <th className="text-right py-2 px-2 font-medium">بالدولار (USD)</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                  <td className="py-2 px-2">
                    <select
                      value={e.type}
                      disabled={disabled}
                      onChange={(ev) => patch(e.id, { type: ev.target.value })}
                      className="w-40 px-2 py-1.5 border border-slate-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-right"
                    >
                      <option value="">اختر البيان</option>
                      {types.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <select
                      value={e.currency}
                      disabled={disabled}
                      onChange={(ev) => patch(e.id, { currency: ev.target.value, rate: rateOf(ev.target.value) })}
                      className="w-28 px-2 py-1.5 border border-slate-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <option value="">اختر عملة</option>
                      {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <AmountInput
                      value={e.amount}
                      disabled={disabled}
                      onChange={(n) => patch(e.id, { amount: n })}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <RateInput
                      value={e.rate || rateOf(e.currency)}
                      disabled={disabled || !e.currency}
                      onChange={(n) => setRowRate(e.id, n)}
                      title={`سعر صرف ${e.currency || "—"} مقابل الدولار — ⁦1 USD = ? ${e.currency || ""}⁩`}
                    />
                  </td>
                  <td className="py-2 px-2">
                    <div className="w-32 px-2 py-1.5 text-sm text-slate-800 font-semibold tabular-nums text-right">
                      {fmt(convert(e.amount, e.rate))}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button onClick={() => remove(e.id)} disabled={disabled}
                      className="text-rose-500 hover:bg-rose-50 p-1.5 rounded disabled:opacity-40" title="حذف">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {/* Add row */}
              <tr>
                <td colSpan={6} className="py-2 px-2">
                  <button onClick={addRow} disabled={disabled}
                    className="w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-slate-300 rounded-md text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/40 disabled:opacity-40">
                    <Plus size={16} /> إضافة بند مصروف
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Expense types manager */}
          <div className="mt-3 border border-slate-200 rounded-md">
            <button onClick={() => setShowTypes((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              <span>{showTypes ? "▲" : "▼"}</span>
              <span>إدارة أنواع المصروفات ({types.length})</span>
            </button>
            {showTypes && (
              <div className="p-3 border-t border-slate-200 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {types.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 border border-slate-200 rounded-full text-xs">
                      {t}
                      <button onClick={() => removeType(t)} className="text-rose-500 hover:text-rose-700"><X size={12} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1">
                  <input value={newType} onChange={(e) => setNewType(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addType(); } }}
                    placeholder="نوع مصروف جديد (مثل: ضرائب، رسوم)..."
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-right" />
                  <button onClick={addType} className="px-3 py-1.5 bg-emerald-600 text-white rounded-md text-sm hover:bg-emerald-700 flex items-center gap-1">
                    <Plus size={14} /> إضافة
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-white">
          <button onClick={refreshRates} disabled={disabled}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40">
            <RefreshCw size={14} /> تحديث أسعار الصرف
          </button>
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)}
              className="px-5 py-2 text-sm text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50">
              إلغاء
            </button>
            <button onClick={save} disabled={disabled}
              className="px-6 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5 font-semibold">
              <Check size={15} /> حفظ
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AmountInput({
  value, onChange, disabled,
}: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  const buf = useNumericBuffer(value || "", true);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={buf.text}
      disabled={disabled}
      onFocus={buf.onFocus}
      onBlur={buf.onBlur}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== "" && !/^-?[\d\u0660-\u0669\u06F0-\u06F9]*[.,،\u066B]?[\d\u0660-\u0669\u06F0-\u06F9]*$/.test(v)) return;
        buf.setText(v);
        onChange(parseDecimal(v));
      }}
      className="w-32 px-2 py-1.5 border border-slate-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-right tabular-nums"
      placeholder="0.00"
    />
  );
}

function RateInput({
  value, onChange, disabled, title,
}: { value: number; onChange: (n: number) => void; disabled?: boolean; title?: string }) {
  const buf = useNumericBuffer(value || "", true);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={buf.text}
      disabled={disabled}
      title={title}
      onFocus={buf.onFocus}
      onBlur={buf.onBlur}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== "" && !/^-?[\d\u0660-\u0669\u06F0-\u06F9]*[.,،\u066B]?[\d\u0660-\u0669\u06F0-\u06F9]*$/.test(v)) return;
        buf.setText(v);
        onChange(parseDecimal(v));
      }}
      className="w-28 px-2 py-1.5 border border-amber-300 rounded-md bg-amber-50/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 text-right tabular-nums disabled:bg-slate-100 disabled:border-slate-200"
      placeholder="1.000000"
    />
  );
}