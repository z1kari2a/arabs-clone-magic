import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer, FileSpreadsheet, Download, CheckCircle2, X, Package } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { ErpTable, Cell, fmt, parseDecimal } from "@/components/erp/ErpUI";
import { erpStore, useErpStore } from "@/lib/erp-store";
import { useAuth, canWrite, canDelete } from "@/lib/auth";
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
  const settings = useErpStore((s) => s.settings);
  const currencies = settings.currencies ?? [];
  const defaultCurrency = settings.defaultCurrency || currencies[0]?.code || "USD";
  const [list, setList] = useState<Item[]>(items);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const hydrated = useErpStore((s) => s.hydrated);
  const { role } = useAuth();
  const mayWrite = canWrite(role);
  const mayDelete = canDelete(role);
  // A viewer must never enter edit mode, whatever the local `editing` flag says.
  const canEditRow = editing && mayWrite;

  // `list` is a local draft seeded at mount — but hydrateStore() fills the store
  // ASYNCHRONOUSLY (from ErpLayout's effect, which runs after this component's
  // first render), so on a fresh page load the seed was always []. Without this
  // sync the table stayed permanently empty and pressing "حفظ" wrote that empty
  // list back over every stored item. Re-sync whenever the store changes while
  // we're not mid-edit, so an in-progress edit is never clobbered.
  useEffect(() => {
    if (!editing) setList(items);
  }, [items, editing]);

  const filtered = list.filter((it) => !search || it.name.includes(search) || it.code.includes(search) || it.barcode.includes(search));
  const patch = (i: number, p: Partial<Item>) => setList(list.map((it, idx) => (idx === i ? { ...it, ...p } : it)));

  const onNew = () => {
    if (!mayWrite) return toast.error("ليس لديك صلاحية لهذا الإجراء");
    // Derive the code from the highest existing MOD-#### rather than the list
    // length, so it can't collide with an item after a deletion or a rename
    // (a collision would silently overwrite that item on save).
    let max = 1000;
    for (const it of list) {
      const m = /^MOD-(\d+)$/.exec(it.code);
      if (m) max = Math.max(max, Number(m[1]));
    }
    setList([...list, { code: `MOD-${max + 1}`, name: "", barcode: "", units: [{ name: "حبة", pack: 1, lastPrice: 0 }], cbmPerCarton: 0, lastCost: 0, currency: defaultCurrency }]);
    setEditing(true);
  };
  const onSave = () => {
    if (!mayWrite) return toast.error("ليس لديك صلاحية لهذا الإجراء");
    if (!hydrated) return toast.error("لم يكتمل تحميل البيانات بعد — انتظر لحظة ثم احفظ");
    const codes = new Set<string>();
    for (const it of list) {
      if (!it.code.trim()) return toast.error("يوجد صنف بدون موديل");
      if (codes.has(it.code)) return toast.error(`موديل مكرر: ${it.code}`);
      codes.add(it.code);
    }
    erpStore.set({ items: list });
    setEditing(false);
    toast.success("تم الحفظ");
  };
  const onDelete = (idx: number) => {
    if (!mayDelete) return toast.error("الحذف يتطلب صلاحية مدير");
    if (!confirm(`حذف الصنف "${list[idx]?.name || list[idx]?.code}"؟`)) return;
    setList(list.filter((_, i) => i !== idx));
    setEditing(true);
    toast.info("تم الحذف من القائمة — اضغط «حفظ» لتثبيته");
  };
  const onExport = () => {
    const ws = XLSX.utils.json_to_sheet(list.map((i) => ({ "الموديل": i.code, "اسم الصنف": i.name, "الباركود": i.barcode, "الوحدة": i.units[0]?.name, "العبوة": i.units[0]?.pack, "آخر سعر": i.units[0]?.lastPrice, "العملة": i.currency ?? defaultCurrency, "CBM": i.cbmPerCarton, "آخر تكلفة (USD)": i.lastCost })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "items.xlsx");
  };
  const noop = () => {};

  const actions = [
    { icon: FilePlus2, label: "جديد", color: "text-emerald-600", onClick: onNew, disabled: !mayWrite },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: noop },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: onSave, disabled: !mayWrite },
    { icon: Pencil, label: "تعديل", color: "text-cyan-600", onClick: () => (mayWrite ? setEditing(true) : toast.error("ليس لديك صلاحية لهذا الإجراء")), disabled: !mayWrite },
    { icon: Trash2, label: "حذف", color: "text-rose-600", onClick: () => toast.info("استخدم زر الحذف في نهاية سطر الصنف") },
    { icon: Search, label: "بحث", color: "text-indigo-500", onClick: () => document.getElementById("it-search")?.focus() },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: () => window.print() },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: noop },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    { icon: CheckCircle2, label: "اعتماد", color: "text-emerald-700", onClick: onSave, disabled: !mayWrite },
    { icon: X, label: "إغلاق", color: "text-rose-600", onClick: () => history.back() },
  ];

  return (
    <ErpLayout title="دليل الأصناف" ribbon={<Ribbon actions={actions} />}>
      <div className="bg-white border border-slate-300 rounded">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
          <div className="flex items-center gap-2 font-semibold text-slate-700"><Package size={16} /> الأصناف ({filtered.length})</div>
          <input id="it-search" placeholder="بحث بالموديل أو الباركود أو الاسم..." value={search} onChange={(e) => setSearch(e.target.value)} className="px-2 py-1 text-xs border border-slate-300 rounded w-72 text-right" />
        </div>
        <ErpTable headers={["م","الموديل","اسم الصنف","الباركود","الوحدة","العبوة","آخر سعر","العملة","CBM الكرتون","آخر تكلفة (USD)","حذف"]}>
          {filtered.map((it, i) => {
            const idx = list.indexOf(it);
            const u0 = it.units[0] ?? { name: "حبة", pack: 1, lastPrice: 0 };
            const cur = it.currency ?? defaultCurrency;
            return (
              <tr key={it.code + i} className="hover:bg-blue-50/40">
                <td className="border border-slate-200 text-center">{i + 1}</td>
                <Cell value={it.code} onChange={(v) => patch(idx, { code: v })} disabled={!canEditRow} />
                <Cell value={it.name} onChange={(v) => patch(idx, { name: v })} disabled={!canEditRow} align="right" />
                <Cell value={it.barcode} onChange={(v) => patch(idx, { barcode: v })} disabled={!canEditRow} />
                <Cell value={u0.name} onChange={(v) => patch(idx, { units: [{ ...u0, name: v }] })} disabled={!canEditRow} />
                <Cell value={u0.pack} onChange={(v) => patch(idx, { units: [{ ...u0, pack: parseDecimal(v) }] })} disabled={!canEditRow} align="right" />
                <td className="border border-slate-200 text-right px-2 bg-slate-50">{fmt(u0.lastPrice)}</td>
                <td className="border border-slate-200 p-0">
                  <select
                    value={cur}
                    disabled={!canEditRow}
                    onChange={(e) => patch(idx, { currency: e.target.value })}
                    className="w-full px-1 py-1 text-xs bg-white disabled:bg-slate-50 border-0 focus:outline-none text-center"
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))}
                  </select>
                </td>
                <Cell value={it.cbmPerCarton} onChange={(v) => patch(idx, { cbmPerCarton: parseDecimal(v) })} disabled={!canEditRow} align="right" />
                <td className="border border-slate-200 text-right px-2 bg-slate-50 font-semibold">{fmt(it.lastCost, 4)}</td>
                <td className="border border-slate-200 text-center">
                  <button onClick={() => onDelete(idx)} disabled={!mayDelete} title={mayDelete ? "حذف الصنف" : "الحذف يتطلب صلاحية مدير"} className="text-rose-600 hover:bg-rose-50 p-1 rounded disabled:opacity-30">
                    <Trash2 size={12} />
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