import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer, FileSpreadsheet, Download, CheckCircle2, X, BarChart3, Wallet } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { ErpTable, fmt, fmtInt } from "@/components/erp/ErpUI";
import { useErpStore, computePO } from "@/lib/erp-store";

const searchSchema = z.object({
  tab: z.enum(["purchases", "items", "expenses", "suppliers"]).optional(),
});

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "التقارير - نظام ERP" },
      { name: "description", content: "تقارير النظام" },
      { property: "og:title", content: "التقارير - نظام ERP" },
      { property: "og:description", content: "شاشة التقارير" },
    ],
  }),
  validateSearch: searchSchema.parse,
  component: ReportsPage,
});

const REPORTS = [
  { id: "purchases", label: "تقرير أوامر الشراء" },
  { id: "items", label: "تقرير الأصناف" },
  { id: "expenses", label: "تقرير المصروفات" },
  { id: "suppliers", label: "تقرير الموردين" },
];

function ReportsPage() {
  const { tab } = Route.useSearch();
  const [reportId, setReportId] = useState<"purchases" | "items" | "expenses" | "suppliers">(tab || "purchases");

  useEffect(() => {
    if (tab) setReportId(tab);
  }, [tab]);
  const orders = useErpStore((s) => s.purchaseOrders);
  const suppliers = useErpStore((s) => s.suppliers);
  const items = useErpStore((s) => s.items);

  const onExport = () => {
    let rows: any[] = [];
    if (reportId === "purchases") rows = orders.map((o) => { const m = computePO(o); return { "رقم الأمر": o.number, "التاريخ": o.date, "المورد": suppliers.find((s) => s.code === o.supplierCode)?.name ?? "", "الأصناف": m.totalItems, "الكمية": m.totalQty, "الشراء": m.totalPurchase, "المصروفات": m.totalExpenses, "التكلفة": m.totalCost }; });
    else if (reportId === "items") rows = items.map((i) => ({ "الموديل": i.code, "الصنف": i.name, "آخر سعر": i.units[0]?.lastPrice, "آخر تكلفة": i.lastCost }));
    else if (reportId === "suppliers") rows = suppliers.map((s) => ({ "الكود": s.code, "الاسم": s.name, "الدولة": s.country, "أوامر": orders.filter((o) => o.supplierCode === s.code).length }));
    else if (reportId === "expenses") rows = orders.flatMap((o) => o.expenses.map((e) => ({ "رقم الأمر": o.number, "النوع": e.type, "البيان": e.note, "المبلغ": e.amount, "بعملة الفاتورة": e.amount * (e.rate || 1) })));
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `${reportId}.xlsx`); toast.success("تم التصدير");
  };
  const noop = () => {};

  const actions = [
    { icon: FilePlus2, label: "جديد", color: "text-emerald-600", onClick: noop },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: noop },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: () => toast.info("التقارير للعرض") },
    { icon: Pencil, label: "تعديل", color: "text-cyan-600", onClick: noop },
    { icon: Trash2, label: "حذف", color: "text-rose-600", onClick: noop },
    { icon: Search, label: "بحث", color: "text-indigo-500", onClick: noop },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: () => window.print() },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: noop },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    { icon: Wallet, label: "المصروفات", hint: "F4", color: "text-orange-600", onClick: () => { setReportId("expenses"); toast.success("تم عرض تقرير المصروفات"); } },
    { icon: CheckCircle2, label: "اعتماد", color: "text-emerald-700", onClick: noop },
    { icon: X, label: "إغلاق", color: "text-rose-600", onClick: () => history.back() },
  ];

  return (
    <ErpLayout title="التقارير" ribbon={<Ribbon actions={actions} />}>
      <div className="bg-white border border-slate-300 rounded">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
          <BarChart3 size={16} />
          <span className="font-semibold text-slate-700">التقارير</span>
          <div className="flex-1" />
          <select value={reportId} onChange={(e) => setReportId(e.target.value as typeof reportId)} className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-right">
            {REPORTS.map((r) => (<option key={r.id} value={r.id}>{r.label}</option>))}
          </select>
        </div>
        <div className="p-2">
          {reportId === "purchases" && (
            <ErpTable headers={["م","رقم الأمر","التاريخ","المورد","الأصناف","الكمية","الشراء","المصروفات","التكلفة","الحالة"]}>
              {orders.map((o, i) => { const m = computePO(o); return (
                <tr key={o.number} className="hover:bg-blue-50/40">
                  <td className="border border-slate-200 text-center">{i + 1}</td>
                  <td className="border border-slate-200 px-2">{o.number}</td>
                  <td className="border border-slate-200 px-2">{o.date}</td>
                  <td className="border border-slate-200 px-2 text-right">{suppliers.find((s) => s.code === o.supplierCode)?.name ?? "-"}</td>
                  <td className="border border-slate-200 px-2 text-right">{fmtInt(m.totalItems)}</td>
                  <td className="border border-slate-200 px-2 text-right">{fmtInt(m.totalQty)}</td>
                  <td className="border border-slate-200 px-2 text-right">{fmt(m.totalPurchase)}</td>
                  <td className="border border-slate-200 px-2 text-right">{fmt(m.totalExpenses)}</td>
                  <td className="border border-slate-200 px-2 text-right bg-amber-50 font-semibold">{fmt(m.totalCost)}</td>
                  <td className="border border-slate-200 text-center">{o.approved ? <span className="text-emerald-600">معتمد</span> : <span className="text-amber-600">مسودة</span>}</td>
                </tr>
              ); })}
            </ErpTable>
          )}
          {reportId === "items" && (
            <ErpTable headers={["م","الموديل","اسم الصنف","الباركود","آخر سعر","آخر تكلفة"]}>
              {items.map((it, i) => (
                <tr key={it.code}>
                  <td className="border border-slate-200 text-center">{i + 1}</td>
                  <td className="border border-slate-200 px-2">{it.code}</td>
                  <td className="border border-slate-200 px-2 text-right">{it.name}</td>
                  <td className="border border-slate-200 px-2">{it.barcode}</td>
                  <td className="border border-slate-200 px-2 text-right">{fmt(it.units[0]?.lastPrice ?? 0)}</td>
                  <td className="border border-slate-200 px-2 text-right bg-amber-50 font-semibold">{fmt(it.lastCost, 4)}</td>
                </tr>
              ))}
            </ErpTable>
          )}
          {reportId === "suppliers" && (
            <ErpTable headers={["م","الكود","الاسم","الدولة","المدينة","الهاتف","عدد الأوامر"]}>
              {suppliers.map((s, i) => (
                <tr key={s.code}>
                  <td className="border border-slate-200 text-center">{i + 1}</td>
                  <td className="border border-slate-200 px-2">{s.code}</td>
                  <td className="border border-slate-200 px-2 text-right">{s.name}</td>
                  <td className="border border-slate-200 px-2 text-right">{s.country}</td>
                  <td className="border border-slate-200 px-2 text-right">{s.city}</td>
                  <td className="border border-slate-200 px-2">{s.phone}</td>
                  <td className="border border-slate-200 text-center font-semibold">{orders.filter((o) => o.supplierCode === s.code).length}</td>
                </tr>
              ))}
            </ErpTable>
          )}
          {reportId === "expenses" && (
            <ErpTable headers={["م","رقم الأمر","النوع","البيان","العملة","المبلغ","بعملة الفاتورة"]}>
              {orders.flatMap((o) => o.expenses.map((e) => ({ o, e }))).map(({ o, e }, i) => (
                <tr key={o.number + e.id}>
                  <td className="border border-slate-200 text-center">{i + 1}</td>
                  <td className="border border-slate-200 px-2">{o.number}</td>
                  <td className="border border-slate-200 px-2 text-right">{e.type}</td>
                  <td className="border border-slate-200 px-2 text-right">{e.note}</td>
                  <td className="border border-slate-200 px-2 text-center">{e.currency}</td>
                  <td className="border border-slate-200 px-2 text-right">{fmt(e.amount)}</td>
                  <td className="border border-slate-200 px-2 text-right bg-amber-50 font-semibold">{fmt(e.amount * (e.rate || 1))}</td>
                </tr>
              ))}
            </ErpTable>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}