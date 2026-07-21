import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer, FileSpreadsheet, Download, CheckCircle2, X, Package } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { ErpTable, Cell, fmt } from "@/components/erp/ErpUI";
import { erpStore, useErpStore } from "@/lib/erp-store";
import type { Item } from "@/lib/erp-types";

export const Route = createFileRoute("/items")({
  head: () => ({
    meta: [
      { title: "دليل الأصناف - نظام ERP" },
      { name: "description", content: "دليل الأصناف الموحد" },
      { property: "og:title", content: "دليل الأصناف - نظام ERP" },
      { property: "og:description", content: "شاشة دليل الأصناف" },
    ],
  }),
  component: ItemsPage,
});

function ItemsPage() {
  const items = useErpStore((s) => s.items);
  const [list, setList] = useState<Item[]>(items);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = list.filter((it) => !search || it.name.includes(search) || it.code.includes(search) || it.barcode.includes(search));
  const patch = (i: number, p: Partial<Item>) => setList(list.map((it, idx) => (idx === i ? { ...it, ...p } : it)));

  const onNew = () => { setList([...list, { code: `MOD-${1000 + list.length + 1}`, name: "", barcode: "", units: [{ name: "حبة", pack: 1, lastPrice: 0 }], cbmPerCarton: 0, lastCost: 0 }]); setEditing(true); };
  const onSave = () => { erpStore.set({ items: list }); setEditing(false); toast.success("تم الحفظ"); };
  const onExport = () => {
    const ws = XLSX.utils.json_to_sheet(list.map((i) => ({ "الموديل": i.code, "اسم الصنف": i.name, "الباركود": i.barcode, "الوحدة": i.units[0]?.name, "العبوة": i.units[0]?.pack, "آخر سعر": i.units[0]?.lastPrice, "CBM": i.cbmPerCarton, "آخر تكلفة": i.lastCost })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "items.xlsx");
  };
  const noop = () => {};

  const actions = [
    { icon: FilePlus2, label: "جديد", color: "text-emerald-600", onClick: onNew },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: noop },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: onSave },
    { icon: Pencil, label: "تعديل", color: "text-cyan-600", onClick: () => setEditing(true) },
    { icon: Trash2, label: "حذف", color: "text-rose-600", onClick: noop },
    { icon: Search, label: "بحث", color: "text-indigo-500", onClick: () => document.getElementById("it-search")?.focus() },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: () => window.print() },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: noop },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    { icon: CheckCircle2, label: "اعتماد", color: "text-emerald-700", onClick: onSave },
    { icon: X, label: "إغلاق", color: "text-rose-600", onClick: () => history.back() },
  ];

  return (
    <ErpLayout title="دليل الأصناف" ribbon={<Ribbon actions={actions} />}>
      <div className="bg-white border border-slate-300 rounded">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
          <div className="flex items-center gap-2 font-semibold text-slate-700"><Package size={16} /> الأصناف ({filtered.length})</div>
          <input id="it-search" placeholder="بحث بالموديل أو الباركود أو الاسم..." value={search} onChange={(e) => setSearch(e.target.value)} className="px-2 py-1 text-xs border border-slate-300 rounded w-72 text-right" />
        </div>
        <ErpTable headers={["م","الموديل","اسم الصنف","الباركود","الوحدة","العبوة","آخر سعر","CBM الكرتون","آخر تكلفة"]}>
          {filtered.map((it, i) => {
            const idx = list.indexOf(it);
            const u0 = it.units[0] ?? { name: "حبة", pack: 1, lastPrice: 0 };
            return (
              <tr key={it.code + i} className="hover:bg-blue-50/40">
                <td className="border border-slate-200 text-center">{i + 1}</td>
                <Cell value={it.code} onChange={(v) => patch(idx, { code: v })} disabled={!editing} />
                <Cell value={it.name} onChange={(v) => patch(idx, { name: v })} disabled={!editing} align="right" />
                <Cell value={it.barcode} onChange={(v) => patch(idx, { barcode: v })} disabled={!editing} />
                <Cell value={u0.name} onChange={(v) => patch(idx, { units: [{ ...u0, name: v }] })} disabled={!editing} />
                <Cell value={String(u0.pack)} onChange={(v) => patch(idx, { units: [{ ...u0, pack: Number(v) || 0 }] })} disabled={!editing} align="right" />
                <td className="border border-slate-200 text-right px-2 bg-slate-50">{fmt(u0.lastPrice)}</td>
                <Cell value={String(it.cbmPerCarton)} onChange={(v) => patch(idx, { cbmPerCarton: Number(v) || 0 })} disabled={!editing} align="right" />
                <td className="border border-slate-200 text-right px-2 bg-amber-50 font-semibold">{fmt(it.lastCost, 4)}</td>
              </tr>
            );
          })}
        </ErpTable>
      </div>
    </ErpLayout>
  );
}