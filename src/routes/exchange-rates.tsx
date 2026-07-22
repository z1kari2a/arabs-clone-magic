import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save, RefreshCw, Star, DollarSign } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { Panel, fmt, parseDecimal } from "@/components/erp/ErpUI";
import { erpStore, useErpStore } from "@/lib/erp-store";
import type { Currency } from "@/lib/erp-types";

export const Route = createFileRoute("/exchange-rates")({
  head: () => ({
    meta: [
      { title: "أسعار الصرف - نظام ERP" },
      { name: "description", content: "إدارة العملات وأسعار الصرف المعتمدة في النظام" },
      { property: "og:title", content: "أسعار الصرف - نظام ERP" },
      { property: "og:description", content: "شاشة إدارة أسعار الصرف" },
    ],
  }),
  component: ExchangeRatesPage,
});

function ExchangeRatesPage() {
  const settings = useErpStore((s) => s.settings);
  const [rows, setRows] = useState<Currency[]>(settings.currencies ?? []);
  const [defCode, setDefCode] = useState<string>(settings.defaultCurrency || rows[0]?.code || "");
  const [nc, setNc] = useState<Currency>({ code: "", name: "", rate: 0 });

  // Re-sync when settings change from other screens
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
    if (!(Number(nc.rate) > 0)) return toast.error("أدخل سعر صرف صالح");
    if (rows.some((r) => r.code === code)) return toast.error("العملة موجودة مسبقاً");
    setRows([...rows, { code, name: nc.name.trim(), rate: Number(nc.rate) }]);
    setNc({ code: "", name: "", rate: 0 });
  };

  const remove = (code: string) => {
    if (rows.length <= 1) return toast.error("يجب الإبقاء على عملة واحدة على الأقل");
    if (code === defCode) return toast.error("لا يمكن حذف العملة الافتراضية");
    setRows(rows.filter((r) => r.code !== code));
  };

  const save = () => {
    // Validation
    const codes = new Set<string>();
    for (const r of rows) {
      if (!r.code) return toast.error("يوجد عملة بدون رمز");
      if (!(r.rate > 0)) return toast.error(`سعر الصرف للعملة ${r.code} غير صالح`);
      if (codes.has(r.code)) return toast.error(`رمز مكرر: ${r.code}`);
      codes.add(r.code);
    }
    if (!codes.has(defCode)) return toast.error("اختر عملة افتراضية موجودة في القائمة");
    erpStore.set({
      settings: { ...settings, currencies: rows, defaultCurrency: defCode },
    });
    toast.success("تم حفظ أسعار الصرف");
  };

  const reset = () => setRows(settings.currencies ?? []);

  const actions = [
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: save },
    { icon: RefreshCw, label: "استرجاع", color: "text-amber-600", onClick: reset },
  ];

  return (
    <ErpLayout title="أسعار الصرف" ribbon={<Ribbon actions={actions} />}>
      <Panel title={<span className="flex items-center gap-2"><DollarSign size={14} className="text-emerald-600" /> العملات وأسعار الصرف المعتمدة</span>}>
        <div className="text-[11px] text-slate-500 mb-2 leading-relaxed">
          كل حساب في النظام (أوامر الشراء، المصروفات، التسعير) يعتمد على هذه القائمة فقط.
          سعر الصرف = كم يساوي 1 من هذه العملة بالعملة الأساسية {baseCode && <b>({baseCode})</b>}.
          أي عملة غير موجودة هنا لن تُقبل في الحسابات.
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-200">
            <thead className="bg-slate-100 text-[12px] text-slate-600">
              <tr>
                <th className="border border-slate-200 w-10 py-1.5">م</th>
                <th className="border border-slate-200 py-1.5 w-20">افتراضي</th>
                <th className="border border-slate-200 py-1.5 w-28">الرمز</th>
                <th className="border border-slate-200 py-1.5">اسم العملة</th>
                <th className="border border-slate-200 py-1.5 w-40">سعر التحويل</th>
                <th className="border border-slate-200 py-1.5 w-40">مثال: 100 → {baseCode}</th>
                <th className="border border-slate-200 py-1.5 w-16">حذف</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.code} className="odd:bg-white even:bg-slate-50/50">
                  <td className="border border-slate-200 text-center text-slate-500">{i + 1}</td>
                  <td className="border border-slate-200 text-center">
                    <button onClick={() => setDefCode(c.code)} title="تعيين كافتراضية"
                      className={c.code === defCode ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}>
                      <Star size={16} className={c.code === defCode ? "fill-amber-400" : ""} />
                    </button>
                  </td>
                  <td className="border border-slate-200 p-1">
                    <input value={c.code} onChange={(e) => patch(c.code, { code: e.target.value.toUpperCase() })}
                      className="w-full px-2 py-1 text-center font-semibold bg-transparent focus:outline-none focus:bg-blue-50/50 rounded" />
                  </td>
                  <td className="border border-slate-200 p-1">
                    <input value={c.name} onChange={(e) => patch(c.code, { name: e.target.value })}
                      className="w-full px-2 py-1 text-right bg-transparent focus:outline-none focus:bg-blue-50/50 rounded" />
                  </td>
                  <td className="border border-slate-200 p-1">
                    <input type="text" inputMode="decimal" value={c.rate || ""}
                      onChange={(e) => patch(c.code, { rate: parseDecimal(e.target.value) })}
                      className="w-full px-2 py-1 text-right tabular-nums bg-transparent focus:outline-none focus:bg-blue-50/50 rounded" />
                  </td>
                  <td className="border border-slate-200 text-center text-slate-600 tabular-nums text-xs">
                    100 {c.code} = {fmt(100 * (c.rate || 0))} {baseCode}
                  </td>
                  <td className="border border-slate-200 text-center">
                    <button onClick={() => remove(c.code)} className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add row */}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end p-3 bg-slate-50 border border-slate-200 rounded">
          <div>
            <label className="text-[11px] text-slate-600 block mb-1">الرمز</label>
            <input value={nc.code} onChange={(e) => setNc({ ...nc, code: e.target.value.toUpperCase() })}
              placeholder="USD" className="w-full px-2 py-1.5 border border-slate-300 rounded text-center font-semibold" />
          </div>
          <div>
            <label className="text-[11px] text-slate-600 block mb-1">اسم العملة</label>
            <input value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })}
              placeholder="دولار" className="w-full px-2 py-1.5 border border-slate-300 rounded text-right" />
          </div>
          <div>
            <label className="text-[11px] text-slate-600 block mb-1">سعر التحويل</label>
            <input type="number" step="0.000001" inputMode="decimal" value={nc.rate || ""}
              onChange={(e) => setNc({ ...nc, rate: parseDecimal(e.target.value) })}
              placeholder="530" className="w-full px-2 py-1.5 border border-slate-300 rounded text-right tabular-nums" />
          </div>
          <button onClick={add} className="flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm">
            <Plus size={14} /> إضافة عملة
          </button>
        </div>

        {/* Prominent Save / Update bar */}
        <div className="mt-3 flex items-center justify-between gap-2 p-3 border rounded bg-gradient-to-l from-blue-50 to-white border-blue-200">
          <div className="text-[12px] text-slate-600">
            {dirty ? (
              <span className="text-amber-700 font-semibold">● يوجد تعديلات لم تُحفظ — اضغط «حفظ وتعديل الأسعار» لتطبيقها على كامل النظام.</span>
            ) : (
              <span className="text-emerald-700">✓ الأسعار محفوظة ومُطبَّقة في كامل النظام.</span>
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
              className={`flex items-center gap-1 px-4 py-2 rounded text-white text-sm font-semibold shadow-sm ${
                dirty ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              <Save size={15} /> {dirty ? "حفظ وتعديل الأسعار" : "حفظ الأسعار"}
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="اختبار سريع للتحويل" className="mt-2">
        <ConversionTester rows={rows} />
      </Panel>
    </ErpLayout>
  );
}

function ConversionTester({ rows }: { rows: Currency[] }) {
  const [amt, setAmt] = useState<number>(100);
  const [from, setFrom] = useState<string>(rows[0]?.code ?? "");
  const [to, setTo] = useState<string>(rows[1]?.code ?? rows[0]?.code ?? "");
  const fr = rows.find((r) => r.code === from);
  const tr = rows.find((r) => r.code === to);
  const result = fr && tr && tr.rate > 0 ? (amt * fr.rate) / tr.rate : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
      <div>
        <label className="text-[11px] text-slate-600 block mb-1">المبلغ</label>
        <input type="number" inputMode="decimal" value={amt || ""} onChange={(e) => setAmt(parseDecimal(e.target.value))}
          className="w-full px-2 py-1.5 border border-slate-300 rounded text-right tabular-nums" />
      </div>
      <div>
        <label className="text-[11px] text-slate-600 block mb-1">من</label>
        <select value={from} onChange={(e) => setFrom(e.target.value)}
          className="w-full px-2 py-1.5 border border-slate-300 rounded">
          {rows.map((r) => <option key={r.code} value={r.code}>{r.code} - {r.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[11px] text-slate-600 block mb-1">إلى</label>
        <select value={to} onChange={(e) => setTo(e.target.value)}
          className="w-full px-2 py-1.5 border border-slate-300 rounded">
          {rows.map((r) => <option key={r.code} value={r.code}>{r.code} - {r.name}</option>)}
        </select>
      </div>
      <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded text-center">
        <div className="text-[10px] text-slate-500">النتيجة</div>
        <div className="text-lg font-bold text-emerald-700 tabular-nums">
          {result === null ? "—" : `${fmt(result)} ${to}`}
        </div>
      </div>
    </div>
  );
}