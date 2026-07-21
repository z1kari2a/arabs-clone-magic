import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer, FileSpreadsheet, Download, CheckCircle2, X, Building2 } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { ErpTable, Cell } from "@/components/erp/ErpUI";
import { erpStore, useErpStore } from "@/lib/erp-store";
import type { Supplier } from "@/lib/erp-types";

export const Route = createFileRoute("/suppliers")({
  head: () => ({
    meta: [
      { title: "الموردون - نظام ERP" },
      { name: "description", content: "إدارة بيانات الموردين" },
      { property: "og:title", content: "الموردون - نظام ERP" },
      { property: "og:description", content: "شاشة إدارة الموردين" },
    ],
  }),
  component: SuppliersPage,
});

function SuppliersPage() {
  const suppliers = useErpStore((s) => s.suppliers);
  const orders = useErpStore((s) => s.purchaseOrders);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState<Supplier[]>(suppliers);

  const filtered = list.filter((s) => !search || s.name.includes(search) || s.code.includes(search) || s.country.includes(search));
  const patch = (i: number, p: Partial<Supplier>) => setList(list.map((s, idx) => (idx === i ? { ...s, ...p } : s)));

  const onNew = () => { setList([...list, { code: `SUP${String(list.length + 1).padStart(4, "0")}`, name: "", country: "", city: "", phone: "", email: "", currency: "USD", notes: "", active: true }]); setEditing(true); };
  const onSave = () => { erpStore.set({ suppliers: list }); setEditing(false); toast.success("تم حفظ الموردين"); };
  const onExport = () => {
    const ws = XLSX.utils.json_to_sheet(list);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
    XLSX.writeFile(wb, "suppliers.xlsx"); toast.success("تم التصدير");
  };
  const noop = () => {};

  const actions = [
    { icon: FilePlus2, label: "جديد", color: "text-emerald-600", onClick: onNew },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: noop },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: onSave },
    { icon: Pencil, label: "تعديل", color: "text-cyan-600", onClick: () => setEditing(true) },
    { icon: Trash2, label: "حذف", color: "text-rose-600", onClick: noop },
    { icon: Search, label: "بحث", color: "text-indigo-500", onClick: () => document.getElementById("sup-search")?.focus() },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: () => window.print() },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: noop },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    { icon: CheckCircle2, label: "اعتماد", color: "text-emerald-700", onClick: onSave },
    { icon: X, label: "إغلاق", color: "text-rose-600", onClick: () => history.back() },
  ];

  return (
    <ErpLayout title="الموردون" ribbon={<Ribbon actions={actions} />}>
      <div className="bg-white border border-slate-300 rounded">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
          <div className="flex items-center gap-2 font-semibold text-slate-700"><Building2 size={16} /> قائمة الموردين ({filtered.length})</div>
          <input id="sup-search" placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} className="px-2 py-1 text-xs border border-slate-300 rounded w-56 text-right" />
        </div>
        <ErpTable headers={["م","كود المورد","اسم المورد","الدولة","المدينة","الهاتف","البريد الإلكتروني","العملة","أوامر","الحالة"]}>
          {filtered.map((s, i) => {
            const idx = list.indexOf(s);
            const ordersCount = orders.filter((o) => o.supplierCode === s.code).length;
            return (
              <tr key={s.code + i} className="hover:bg-blue-50/40">
                <td className="border border-slate-200 text-center">{i + 1}</td>
                <Cell value={s.code} onChange={(v) => patch(idx, { code: v })} disabled={!editing} />
                <Cell value={s.name} onChange={(v) => patch(idx, { name: v })} disabled={!editing} align="right" />
                <Cell value={s.country} onChange={(v) => patch(idx, { country: v })} disabled={!editing} align="right" />
                <Cell value={s.city} onChange={(v) => patch(idx, { city: v })} disabled={!editing} align="right" />
                <Cell value={s.phone} onChange={(v) => patch(idx, { phone: v })} disabled={!editing} />
                <Cell value={s.email} onChange={(v) => patch(idx, { email: v })} disabled={!editing} />
                <Cell value={s.currency} onChange={(v) => patch(idx, { currency: v })} disabled={!editing} />
                <td className="border border-slate-200 text-center font-semibold">{ordersCount}</td>
                <td className="border border-slate-200 text-center">
                  <button disabled={!editing} onClick={() => patch(idx, { active: !s.active })} className={`px-2 py-0.5 rounded text-xs ${s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"} disabled:opacity-70`}>
                    {s.active ? "نشط" : "موقوف"}
                  </button>
                </td>
              </tr>
            );
          })}
        </ErpTable>
      </div>
    </ErpLayout>
  );
}