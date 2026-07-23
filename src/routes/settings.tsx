import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer, FileSpreadsheet, Download, CheckCircle2, X, RefreshCw, Plus, Star, DollarSign, Lock } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { Panel, FieldRow, ErpInput, ErpSelect, ErpTable, Cell, fmt, parseDecimal, useNumericBuffer } from "@/components/erp/ErpUI";
import { erpStore, useErpStore } from "@/lib/erp-store";
import type { PriceTier, Currency } from "@/lib/erp-types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "الإعدادات - نظام ERP" },
      { name: "description", content: "إعدادات النظام العامة" },
      { property: "og:title", content: "الإعدادات - نظام ERP" },
      { property: "og:description", content: "شاشة الإعدادات" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const settings = useErpStore((s) => s.settings);
  const [local, setLocal] = useState(settings);
  const tiers: PriceTier[] = local.priceTiers ?? [];
  const setTiers = (t: PriceTier[]) => setLocal({ ...local, priceTiers: t });
  const addTier = () => setTiers([...tiers, { id: "t_" + Date.now(), name: "تسعيرة جديدة", extraPct: 0, profitPct: 30 }]);
  const rmTier = (id: string) => setTiers(tiers.filter((t) => t.id !== id));
  const patchTier = (id: string, p: Partial<PriceTier>) =>
    setTiers(tiers.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const currencies: Currency[] = local.currencies ?? [];

  const onSave = () => { erpStore.set({ settings: local }); toast.success("تم حفظ الإعدادات"); };
  const onReset = () => { if (confirm("إعادة تعيين كل البيانات؟")) { erpStore.reset(); toast.success("تم إعادة التعيين"); location.reload(); } };
  const noop = () => {};

  const actions = [
    { icon: FilePlus2, label: "جديد", color: "text-emerald-600", onClick: noop },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: noop },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: onSave },
    { icon: Pencil, label: "تعديل", color: "text-cyan-600", onClick: noop },
    { icon: Trash2, label: "حذف", color: "text-rose-600", onClick: noop },
    { icon: Search, label: "بحث", color: "text-indigo-500", onClick: noop },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: () => window.print() },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: noop },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: noop },
    { icon: CheckCircle2, label: "اعتماد", color: "text-emerald-700", onClick: onSave },
    { icon: X, label: "إغلاق", color: "text-rose-600", onClick: () => history.back() },
  ];

  return (
    <ErpLayout title="الإعدادات" ribbon={<Ribbon actions={actions} />}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 max-w-4xl">
        <Panel title="إعدادات الشركة">
          <div className="space-y-2">
            <FieldRow label="اسم الشركة"><ErpInput value={local.companyName} onChange={(v) => setLocal({ ...local, companyName: v })} align="right" /></FieldRow>
            <FieldRow label="السنة المالية"><ErpInput value={local.fiscalYear} onChange={(v) => setLocal({ ...local, fiscalYear: v })} align="right" /></FieldRow>
            <FieldRow label="العملة الافتراضية">
              <ErpSelect value={local.defaultCurrency} onChange={(v) => setLocal({ ...local, defaultCurrency: v })} options={[
                { value: "USD", label: "USD - دولار أمريكي" },
                { value: "EUR", label: "EUR - يورو" },
                { value: "SAR", label: "SAR - ريال سعودي" },
                { value: "JOD", label: "JOD - دينار أردني" },
              ]} />
            </FieldRow>
            <FieldRow label="اللغة">
              <ErpSelect value={local.language} onChange={(v) => setLocal({ ...local, language: v as any })} options={[
                { value: "ar", label: "العربية" },
                { value: "en", label: "English" },
              ]} />
            </FieldRow>
          </div>
        </Panel>
        <Panel title="إدارة البيانات">
          <div className="space-y-3 text-xs text-slate-600">
            <p>يتم تخزين بيانات النظام محلياً في المتصفح.</p>
            <button onClick={onReset} className="flex items-center gap-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded text-rose-700 hover:bg-rose-100">
              <RefreshCw size={14} /> إعادة تعيين النظام
            </button>
          </div>
        </Panel>
      </div>

      <Panel title="تسعيرات الفروع / الوجهات" className="mt-2">
        <div className="flex justify-between items-center mb-2">
          <div className="text-xs text-slate-600">
            كل تسعيرة تُضيف نسبة على متوسط التكلفة (مصاريف وجهة) + نسبة ربح. تنعكس مباشرة على شاشة أمر الشراء.
          </div>
          <button onClick={addTier} className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-emerald-300 rounded hover:bg-emerald-50">
            <Plus size={12} className="text-emerald-600" /> إضافة تسعيرة
          </button>
        </div>
        <ErpTable headers={["م", "اسم التسعيرة", "نسبة إضافية على التكلفة %", "نسبة الربح %", "حذف"]}>
          {tiers.map((t, i) => (
            <tr key={t.id} className="odd:bg-white even:bg-slate-50/50">
              <td className="border border-slate-200 text-center text-slate-500 w-10">{i + 1}</td>
              <Cell value={t.name} onChange={(v) => patchTier(t.id, { name: v })} align="right" />
              <Cell value={t.extraPct} onChange={(v) => patchTier(t.id, { extraPct: parseDecimal(v) })} align="right" type="number" />
              <Cell value={t.profitPct} onChange={(v) => patchTier(t.id, { profitPct: parseDecimal(v) })} align="right" type="number" />
              <td className="border border-slate-200 text-center">
                <button onClick={() => rmTier(t.id)} className="text-rose-600 hover:bg-rose-50 px-2 rounded"><Trash2 size={12} /></button>
              </td>
            </tr>
          ))}
        </ErpTable>
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
        if (v !== "" && !/^-?[\d]*[.,]?[\d]*$/.test(v)) return;
        buf.setText(v);
        onChange(parseDecimal(v));
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

// ============ Currencies (single source of truth) ============
// This is the ONLY place in the app where exchange rates can be edited.
// All other screens read rates from settings.currencies read-only.
function CurrenciesPanel() {
  const settings = useErpStore((s) => s.settings);
  const [rows, setRows] = useState<Currency[]>(settings.currencies ?? []);
  const [defCode, setDefCode] = useState<string>(settings.defaultCurrency || rows[0]?.code || "");
  const [nc, setNc] = useState<Currency>({ code: "", name: "", rate: 0 });

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
    toast.success("تم حفظ قائمة العملات");
  };

  const reset = () => setRows(settings.currencies ?? []);

  return (
    <Panel
      className="mt-2"
      title={<span className="flex items-center gap-2"><DollarSign size={14} className="text-emerald-600" /> العملات المعتمدة</span>}
    >
      <div className="text-[11px] text-slate-500 mb-2 leading-relaxed">
        هنا تُدار قائمة العملات المعتمدة فقط (رمز واسم). سعر الصرف يُدخَل مباشرة بجانب العملة في الشاشات التي تستعملها (أمر الشراء، المصروفات، دليل الأصناف) لتفادي التعارضات.
        {baseCode && <> العملة الأساسية للنظام: <b>{baseCode}</b>.</>}
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm border border-slate-200">
          <thead className="bg-slate-100 text-[12px] text-slate-600">
            <tr>
              <th className="border border-slate-200 w-10 py-1.5">م</th>
              <th className="border border-slate-200 py-1.5 w-20">افتراضي</th>
              <th className="border border-slate-200 py-1.5 w-28">الرمز</th>
              <th className="border border-slate-200 py-1.5">اسم العملة</th>
              <th className="border border-slate-200 py-1.5 w-16">حذف</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.code + i} className="odd:bg-white even:bg-slate-50/50">
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

      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 items-end p-3 bg-slate-50 border border-slate-200 rounded">
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
        <button onClick={add} className="flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm">
          <Plus size={14} /> إضافة عملة
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 p-3 border rounded bg-gradient-to-l from-blue-50 to-white border-blue-200">
        <div className="text-[12px] text-slate-600">
          {dirty ? (
            <span className="text-amber-700 font-semibold">● يوجد تعديلات لم تُحفظ.</span>
          ) : (
            <span className="text-emerald-700">✓ قائمة العملات محفوظة.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reset} disabled={!dirty}
            className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
            <RefreshCw size={14} /> استرجاع
          </button>
          <button onClick={save}
            className={`flex items-center gap-1 px-4 py-2 rounded text-white text-sm font-semibold shadow-sm ${dirty ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
            <Save size={15} /> {dirty ? "حفظ التعديلات" : "محفوظ"}
          </button>
        </div>
      </div>
    </Panel>
  );
}