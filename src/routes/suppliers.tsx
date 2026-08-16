import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer, FileSpreadsheet, Download, CheckCircle2, X, Building2 } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { useCloseGuard } from "@/components/erp/CloseGuard";
import { ErpTable, Cell } from "@/components/erp/ErpUI";
import { cell } from "@/lib/sheet";
import { erpStore, useErpStore } from "@/lib/erp-store";
import { useAuth, canWrite, canDelete } from "@/lib/auth";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const hydrated = useErpStore((s) => s.hydrated);
  const { role } = useAuth();
  const mayWrite = canWrite(role);
  const mayDelete = canDelete(role);
  // A viewer must never edit, whatever the local `editing` flag says.
  const canEditRow = editing && mayWrite;

  // See items.tsx: the store hydrates asynchronously AFTER this component's
  // first render, so seeding `list` once left the table permanently empty on a
  // fresh load — and saving then wrote that empty list over the stored data.
  useEffect(() => {
    if (!editing) setList(suppliers);
  }, [suppliers, editing]);

  const filtered = list.filter((s) => !search || s.name.includes(search) || s.code.includes(search) || s.country.includes(search));
  const patch = (i: number, p: Partial<Supplier>) => setList(list.map((s, idx) => (idx === i ? { ...s, ...p } : s)));

  const onNew = () => {
    if (!mayWrite) return toast.error("ليس لديك صلاحية لهذا الإجراء");
    // Highest existing SUP#### + 1 — deriving it from the list length collided
    // with an existing supplier after any deletion, silently overwriting it.
    let max = 0;
    for (const s of list) {
      const m = /^SUP(\d+)$/.exec(s.code);
      if (m) max = Math.max(max, Number(m[1]));
    }
    setList([...list, { code: `SUP${String(max + 1).padStart(4, "0")}`, name: "", country: "", city: "", phone: "", email: "", currency: "USD", notes: "", active: true }]);
    setEditing(true);
  };
  // يُعيد true/false ليعرف حارس الإغلاق هل نجح الحفظ فيُغلق الشاشة.
  const onSave = (): boolean => {
    if (!mayWrite) { toast.error("ليس لديك صلاحية لهذا الإجراء"); return false; }
    if (!hydrated) { toast.error("لم يكتمل تحميل البيانات بعد — انتظر لحظة ثم احفظ"); return false; }
    const codes = new Set<string>();
    for (const s of list) {
      if (!s.code.trim()) { toast.error("يوجد مورد بدون كود"); return false; }
      if (codes.has(s.code)) { toast.error(`كود مكرر: ${s.code}`); return false; }
      codes.add(s.code);
    }
    erpStore.set({ suppliers: list });
    setEditing(false);
    toast.success("تم حفظ الموردين");
    return true;
  };
  const onDelete = (idx: number) => {
    if (!mayDelete) return toast.error("الحذف يتطلب صلاحية مدير");
    const s = list[idx];
    const used = orders.filter((o) => o.supplierCode === s.code).length;
    if (used) return toast.error(`لا يمكن حذف «${s.name || s.code}» — مرتبط بـ ${used} أمر شراء`);
    if (!confirm(`حذف المورد "${s.name || s.code}"؟`)) return;
    setList(list.filter((_, i) => i !== idx));
    setEditing(true);
    toast.info("تم الحذف من القائمة — اضغط «حفظ» لتثبيته");
  };
  const onExport = () => {
    const ws = XLSX.utils.json_to_sheet(list);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
    XLSX.writeFile(wb, "suppliers.xlsx"); toast.success("تم التصدير");
  };
  // ---- استيراد Excel ----
  // كود المورد هو المفتاح: الموجود يُحدَّث والجديد يُضاف — لا تُستبدل القائمة
  // كلّها. عمود ناقص يُبقي القيمة الحالية. الأعمدة المقبولة: رؤوس هذا الجدول
  // بالعربية، وأسماء الحقول الإنجليزية التي يصدّرها الزر المجاور.
  const onImport = () => {
    if (!mayWrite) return toast.error("ليس لديك صلاحية لهذا الإجراء");
    fileRef.current?.click();
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    let data: Record<string, unknown>[] = [];
    try {
      const wb = XLSX.read(await f.arrayBuffer());
      data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    } catch {
      return toast.error("تعذّرت قراءة الملف — تأكد أنه ملف Excel صالح");
    }
    if (!data.length) return toast.error("الملف فارغ — لا توجد أسطر لاستيرادها");

    const text = (v: unknown, fallback: string) => (v === undefined ? fallback : String(v).trim());
    const next = [...list];
    let added = 0, updated = 0, skipped = 0;
    for (const row of data) {
      const code = String(cell(row, "كود المورد", "code") ?? "").trim();
      if (!code) { skipped++; continue; }
      const name = cell(row, "اسم المورد", "name");
      const country = cell(row, "الدولة", "country");
      const city = cell(row, "المدينة", "city");
      const phone = cell(row, "الهاتف", "phone");
      const email = cell(row, "البريد الإلكتروني", "email");
      const currency = cell(row, "العملة", "currency");
      const notes = cell(row, "ملاحظات", "notes");
      // الحالة تُكتب في الملف نصاً («نشط»/«موقوف») أو منطقياً (TRUE/FALSE) —
      // وأي شيء آخر يترك المورد على حالته الحالية بدل أن يوقفه بالخطأ.
      const raw = cell(row, "الحالة", "active");
      const activeText = raw === undefined ? "" : String(raw).trim().toLowerCase();
      const active =
        ["نشط", "true", "1", "yes", "active"].includes(activeText) ? true :
        ["موقوف", "false", "0", "no", "inactive"].includes(activeText) ? false : undefined;

      const at = next.findIndex((s) => s.code === code);
      if (at < 0) {
        next.push({
          code,
          name: text(name, ""), country: text(country, ""), city: text(city, ""),
          phone: text(phone, ""), email: text(email, ""),
          currency: text(currency, "USD"), notes: text(notes, ""),
          active: active ?? true,
        });
        added++;
      } else {
        const prev = next[at];
        next[at] = {
          ...prev,
          name: text(name, prev.name), country: text(country, prev.country), city: text(city, prev.city),
          phone: text(phone, prev.phone), email: text(email, prev.email),
          currency: text(currency, prev.currency), notes: text(notes, prev.notes),
          active: active ?? prev.active,
        };
        updated++;
      }
    }

    if (!added && !updated) return toast.error("لا يوجد عمود «كود المورد» في الملف — لم يُستورد شيء");
    setList(next);
    setEditing(true);
    toast.success(
      `تم استيراد ${added + updated} مورد (${added} جديد، ${updated} محدَّث` +
        `${skipped ? `، ${skipped} سطر بلا كود` : ""}) — اضغط «حفظ» لتثبيتها`,
    );
  };
  const noop = () => {};

  // حارس الإغلاق: «تعديل» هنا يعني قائمة محلية لم تُكتب في التخزين بعد.
  const closeGuard = useCloseGuard({
    dirty: editing && mayWrite,
    title: "الموردين",
    onSave: mayWrite ? onSave : undefined,
    onDiscard: () => setList(suppliers), // تراجع عن التعديلات المحلية
  });

  const actions = [
    { icon: FilePlus2, label: "جديد", color: "text-emerald-600", onClick: onNew, disabled: !mayWrite },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: noop },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: onSave, disabled: !mayWrite },
    { icon: Pencil, label: "تعديل", color: "text-cyan-600", onClick: () => (mayWrite ? setEditing(true) : toast.error("ليس لديك صلاحية لهذا الإجراء")), disabled: !mayWrite },
    { icon: Trash2, label: "حذف", color: "text-rose-600", onClick: () => toast.info("استخدم زر الحذف في نهاية سطر المورد") },
    { icon: Search, label: "بحث", color: "text-indigo-500", onClick: () => document.getElementById("sup-search")?.focus() },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: () => window.print() },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: onImport, disabled: !mayWrite },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    { icon: CheckCircle2, label: "اعتماد", color: "text-emerald-700", onClick: onSave, disabled: !mayWrite },
    { icon: X, label: "إغلاق", hint: "Esc", color: "text-rose-600", onClick: closeGuard.requestClose },
  ];

  return (
    <ErpLayout title="الموردون" ribbon={<Ribbon actions={actions} />}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
      <div className="bg-white border border-slate-300 rounded">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
          <div className="flex items-center gap-2 font-semibold text-slate-700"><Building2 size={16} /> قائمة الموردين ({filtered.length})</div>
          <input id="sup-search" placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} className="px-2 py-1 text-xs border border-slate-300 rounded w-56 text-right" />
        </div>
        <ErpTable headers={["م","كود المورد","اسم المورد","الدولة","المدينة","الهاتف","البريد الإلكتروني","العملة","أوامر","الحالة","حذف"]}>
          {filtered.map((s, i) => {
            const idx = list.indexOf(s);
            const ordersCount = orders.filter((o) => o.supplierCode === s.code).length;
            return (
              <tr key={s.code + i} className="hover:bg-blue-50/40">
                <td className="border border-slate-200 text-center">{i + 1}</td>
                <Cell value={s.code} onChange={(v) => patch(idx, { code: v })} disabled={!canEditRow} />
                <Cell value={s.name} onChange={(v) => patch(idx, { name: v })} disabled={!canEditRow} align="right" />
                <Cell value={s.country} onChange={(v) => patch(idx, { country: v })} disabled={!canEditRow} align="right" />
                <Cell value={s.city} onChange={(v) => patch(idx, { city: v })} disabled={!canEditRow} align="right" />
                <Cell value={s.phone} onChange={(v) => patch(idx, { phone: v })} disabled={!canEditRow} />
                <Cell value={s.email} onChange={(v) => patch(idx, { email: v })} disabled={!canEditRow} />
                <Cell value={s.currency} onChange={(v) => patch(idx, { currency: v })} disabled={!canEditRow} />
                <td className="border border-slate-200 text-center font-semibold">{ordersCount}</td>
                <td className="border border-slate-200 text-center">
                  <button disabled={!canEditRow} onClick={() => patch(idx, { active: !s.active })} className={`px-2 py-0.5 rounded text-xs ${s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"} disabled:opacity-70`}>
                    {s.active ? "نشط" : "موقوف"}
                  </button>
                </td>
                <td className="border border-slate-200 text-center">
                  <button onClick={() => onDelete(idx)} disabled={!mayDelete} title={mayDelete ? "حذف المورد" : "الحذف يتطلب صلاحية مدير"} className="text-rose-600 hover:bg-rose-50 p-1 rounded disabled:opacity-30">
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            );
          })}
        </ErpTable>
      </div>
      {closeGuard.dialog}
    </ErpLayout>
  );
}