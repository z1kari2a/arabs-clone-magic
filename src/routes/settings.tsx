import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer, FileSpreadsheet, Download, CheckCircle2, X, RefreshCw } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { Panel, FieldRow, ErpInput, ErpSelect } from "@/components/erp/ErpUI";
import { erpStore, useErpStore } from "@/lib/erp-store";

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
    </ErpLayout>
  );
}