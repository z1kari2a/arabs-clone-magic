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

