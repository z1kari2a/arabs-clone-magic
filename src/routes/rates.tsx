import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save, RefreshCw, Plus, Trash2, Star, DollarSign, Info } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { Panel, fmt, parseDecimal, useNumericBuffer } from "@/components/erp/ErpUI";
import { erpStore, useErpStore } from "@/lib/erp-store";
import type { Currency } from "@/lib/erp-types";

export const Route = createFileRoute("/rates")({
  head: () => ({
    meta: [
      { title: "أسعار الصرف - نظام ERP" },
      { name: "description", content: "أسعار الصرف الحالية المعتمدة في النظام" },
      { property: "og:title", content: "أسعار الصرف - نظام ERP" },
      { property: "og:description", content: "إدارة أسعار صرف العملات" },
    ],
  }),
  component: RatesPage,
});

function RatesPage() {
  const settings = useErpStore((s) => s.settings);
  const [rows, setRows] = useState<Currency[]>(settings.currencies ?? []);
  const [defCode, setDefCode] = useState<string>(settings.defaultCurrency || "");
  const [nc, setNc] = useState<{ code: string; name: string; rate: number }>({ code: "", name: "", rate: 0 });

  useEffect(() => {
    setRows(settings.currencies ?? []);
    setDefCode(settings.defaultCurrency || settings.currencies?.[0]?.code || "");
  }, [settings.currencies, settings.defaultCurrency]);

  const dirty =
    JSON.stringify(rows) !== JSON.stringify(settings.currencies ?? []) ||
    defCode !== (settings.defaultCurrency || "");
  const baseCode = rows[0]?.code ?? "";

  const patch = (code: string, p: Partial<Currency>) =>
    setRows(rows.map((r) => (r.code === code ? { ...r, ...p } : r)));

  const add = () => {
    const code = nc.code.trim().toUpperCase();
    if (!code) return toast.error("أدخل رمز العملة");
    if (!nc.name.trim()) return toast.error("أدخل اسم العملة");
    if (rows.some((r) => r.code === code)) return toast.error("العملة موجودة مسبقاً");
    setRows([...rows, { code, name: nc.name.trim(), rate: Number(nc.rate) || 0 }]);
    setNc({ code: "", name: "", rate: 0 });
  };

  const remove = (code: string) => {
    if (rows.length <= 1) return toast.error("يجب الإبقاء على عملة واحدة على الأقل");
    if (code === defCode) return toast.error("لا يمكن حذف العملة الافتراضية");
    setRows(rows.filter((r) => r.code !== code));
  };

  const save = () => {
    const codes = new Set<string>();
    for (const r of rows) {
      if (!r.code) return toast.error("يوجد عملة بدون رمز");
      if (codes.has(r.code)) return toast.error(`رمز مكرر: ${r.code}`);
      codes.add(r.code);
    }
    if (!codes.has(defCode)) return toast.error("اختر عملة افتراضية موجودة في القائمة");
    erpStore.set({ settings: { ...settings, currencies: rows, defaultCurrency: defCode } });
    toast.success("تم حفظ الأسعار — الفواتير القديمة لن تتأثر (السعر مثبت على كل مستند)");
  };

  const reset = () => setRows(settings.currencies ?? []);

  const actions = [
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: save },
    { icon: RefreshCw, label: "استرجاع", color: "text-slate-600", onClick: reset },
  ];

  return (
    <ErpLayout title="أسعار الصرف" ribbon={<Ribbon actions={actions} />}>
      <Panel
        title={<span className="flex items-center gap-2"><DollarSign size={14} className="text-emerald-600" /> أسعار الصرف الحالية</span>}
      >
        <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded flex items-start gap-2 text-[12px] text-amber-800">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            السعر هنا يُستخدم للمستندات الجديدة فقط. كل فاتورة/أمر شراء/سطر مصروف تخزن سعر صرفها لحظة الحفظ،
            فلن تتغير حساباتها عند تعديل الأسعار لاحقاً. العملة الأساسية للنظام: <b>{baseCode || "—"}</b>.
          </span>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-200">
            <thead className="bg-slate-100 text-[12px] text-slate-600">
              <tr>
                <th className="border border-slate-200 w-10 py-1.5">م</th>
                <th className="border border-slate-200 py-1.5 w-20">افتراضي</th>
                <th className="border border-slate-200 py-1.5 w-28">الرمز</th>
                <th className="border border-slate-200 py-1.5">اسم العملة</th>
                <th className="border border-slate-200 py-1.5 w-44">سعر التحويل (مقابل {baseCode})</th>
                <th className="border border-slate-200 py-1.5 w-44">مثال: 100 → {baseCode}</th>
                <th className="border border-slate-200 py-1.5 w-16">حذف</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.code + i} className="odd:bg-white even:bg-slate-50/50">
                  <td className="border border-slate-200 text-center text-slate-500">{i + 1}</td>
                  <td className="border border-slate-200 text-center">
                    <button
                      onClick={() => setDefCode(c.code)}
                      title="تعيين كافتراضية"
                      className={c.code === defCode ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}
                    >
                      <Star size={16} className={c.code === defCode ? "fill-amber-400" : ""} />
                    </button>
                  </td>
                  <td className="border border-slate-200 p-1">
                    <input
                      value={c.code}
                      onChange={(e) => patch(c.code, { code: e.target.value.toUpperCase() })}
                      className="w-full px-2 py-1 text-center font-semibold bg-transparent focus:outline-none focus:bg-blue-50/50 rounded"
                    />
                  </td>
                  <td className="border border-slate-200 p-1">
                    <input
                      value={c.name}
                      onChange={(e) => patch(c.code, { name: e.target.value })}
                      className="w-full px-2 py-1 text-right bg-transparent focus:outline-none focus:bg-blue-50/50 rounded"
                    />
                  </td>
                  <td className="border border-slate-200 p-1">
                    <RateInput
                      value={c.rate}
                      onChange={(n) => patch(c.code, { rate: n })}
                      className="w-full px-2 py-1 text-right tabular-nums bg-amber-50/40 focus:outline-none focus:bg-amber-50 rounded border border-transparent focus:border-amber-300"
                    />
                  </td>
                  <td className="border border-slate-200 text-center text-slate-600 tabular-nums text-xs">
                    100 {c.code} = {fmt(100 * (c.rate || 0))} {baseCode}
                  </td>
                  <td className="border border-slate-200 text-center">
                    <button
                      onClick={() => remove(c.code)}
                      className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end p-3 bg-slate-50 border border-slate-200 rounded">
          <div>
            <label className="text-[11px] text-slate-600 block mb-1">الرمز</label>
            <input
              value={nc.code}
              onChange={(e) => setNc({ ...nc, code: e.target.value.toUpperCase() })}
              placeholder="USD"
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-center font-semibold"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-600 block mb-1">اسم العملة</label>
            <input
              value={nc.name}
              onChange={(e) => setNc({ ...nc, name: e.target.value })}
              placeholder="دولار"
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-right"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-600 block mb-1">سعر التحويل</label>
            <RateInput
              value={nc.rate}
              onChange={(n) => setNc({ ...nc, rate: n })}
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-right tabular-nums"
            />
          </div>
          <button
            onClick={add}
            className="flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm"
          >
            <Plus size={14} /> إضافة عملة
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 p-3 border rounded bg-gradient-to-l from-blue-50 to-white border-blue-200">
          <div className="text-[12px] text-slate-600">
            {dirty ? (
              <span className="text-amber-700 font-semibold">● يوجد تعديلات لم تُحفظ.</span>
            ) : (
              <span className="text-emerald-700">✓ الأسعار محفوظة.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              disabled={!dirty}
              className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} /> استرجاع
            </button>
            <button
              onClick={save}
              className={`flex items-center gap-1 px-4 py-2 rounded text-white text-sm font-semibold shadow-sm ${dirty ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
            >
              <Save size={15} /> {dirty ? "حفظ الأسعار" : "محفوظ"}
            </button>
          </div>
        </div>
      </Panel>
    </ErpLayout>
  );
}

function RateInput({
  value, onChange, className, placeholder,
}: { value: number; onChange: (n: number) => void; className?: string; placeholder?: string }) {
  const buf = useNumericBuffer(value || "", true);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={buf.text}
      onFocus={buf.onFocus}
      onBlur={buf.onBlur}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== "" && !/^-?[\d\u0660-\u0669\u06F0-\u06F9]*[.,،\u066B]?[\d\u0660-\u0669\u06F0-\u06F9]*$/.test(v)) return;
        buf.setText(v);
        onChange(parseDecimal(v));
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}