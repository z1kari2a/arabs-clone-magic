import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  FilePlus2,
  FolderOpen,
  Save,
  Pencil,
  Trash2,
  Search,
  Printer,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  X,
  Package,
} from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { useCloseGuard } from "@/components/erp/CloseGuard";
import { ErpTable, Cell, fmt, parseDecimal } from "@/components/erp/ErpUI";
import { cell, num } from "@/lib/sheet";
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
  const fileRef = useRef<HTMLInputElement>(null);
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

  const filtered = list.filter(
    (it) =>
      !search ||
      it.name.includes(search) ||
      it.code.includes(search) ||
      it.barcode.includes(search),
  );
  const patch = (i: number, p: Partial<Item>) =>
    setList(list.map((it, idx) => (idx === i ? { ...it, ...p } : it)));

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
    setList([
      ...list,
      {
        code: `MOD-${max + 1}`,
        name: "",
        barcode: "",
        units: [{ name: "حبة", pack: 1, lastPrice: 0 }],
        cbmPerCarton: 0,
        lastCost: 0,
        currency: defaultCurrency,
      },
    ]);
    setEditing(true);
  };
  // يُعيد true/false ليعرف حارس الإغلاق هل نجح الحفظ فيُغلق الشاشة.
  const onSave = (): boolean => {
    if (!mayWrite) {
      toast.error("ليس لديك صلاحية لهذا الإجراء");
      return false;
    }
    if (!hydrated) {
      toast.error("لم يكتمل تحميل البيانات بعد — انتظر لحظة ثم احفظ");
      return false;
    }
    const codes = new Set<string>();
    for (const it of list) {
      if (!it.code.trim()) {
        toast.error("يوجد صنف بدون موديل");
        return false;
      }
      if (codes.has(it.code)) {
        toast.error(`موديل مكرر: ${it.code}`);
        return false;
      }
      codes.add(it.code);
    }
    erpStore.set({ items: list });
    setEditing(false);
    toast.success("تم الحفظ");
    return true;
  };
  const onDelete = (idx: number) => {
    if (!mayDelete) return toast.error("الحذف يتطلب صلاحية مدير");
    if (!confirm(`حذف الصنف "${list[idx]?.name || list[idx]?.code}"؟`)) return;
    setList(list.filter((_, i) => i !== idx));
    setEditing(true);
    toast.info("تم الحذف من القائمة — اضغط «حفظ» لتثبيته");
  };
  const onExport = () => {
    const ws = XLSX.utils.json_to_sheet(
      list.map((i) => ({
        الموديل: i.code,
        "اسم الصنف": i.name,
        الباركود: i.barcode,
        الوحدة: i.units[0]?.name,
        العبوة: i.units[0]?.pack,
        "آخر سعر": i.units[0]?.lastPrice,
        العملة: i.currency ?? defaultCurrency,
        CBM: i.cbmPerCarton,
        "آخر تكلفة (USD)": i.lastCost,
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "items.xlsx");
  };

  // ---- استيراد Excel ----
  // الموديل هو المفتاح: الصنف الموجود يُحدَّث والجديد يُضاف — لا يُستبدل الدليل
  // كلّه، فملف يحوي عشرة أصناف لا يجوز أن يمحو مئة. عمود ناقص في الملف يُبقي
  // القيمة الحالية كما هي بدل أن يصفّرها.
  // الأعمدة المقبولة هي نفسها التي يصدّرها الزر المجاور (بالعربية) ومقابلاتها
  // الإنجليزية، حتى يعمل الاستيراد على ملف خرج من هذه الشاشة نفسها.
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

    const next = [...list];
    let added = 0,
      updated = 0,
      skipped = 0;
    for (const row of data) {
      const code = String(cell(row, "الموديل", "model", "code") ?? "").trim();
      if (!code) {
        skipped++;
        continue;
      }
      const name = cell(row, "اسم الصنف", "name");
      const barcode = cell(row, "الباركود", "barcode");
      const unit = cell(row, "الوحدة", "unit");
      const pack = cell(row, "العبوة", "pack");
      const price = cell(row, "آخر سعر", "سعر الشراء", "price");
      const cbm = cell(row, "CBM الكرتون", "CBM", "cbm");
      const cost = cell(row, "آخر تكلفة (USD)", "lastCost");
      // عملة غير موجودة في جدول العملات تُتجاهل: تخزينها يجعل كل حساب يقع على
      // سعر صرف 0 (انظر costingBase) فتخرج التكاليف أصفاراً.
      const cur = String(cell(row, "العملة", "currency") ?? "")
        .trim()
        .toUpperCase();
      const currency = currencies.some((c) => c.code === cur) ? cur : undefined;

      const at = next.findIndex((it) => it.code === code);
      if (at < 0) {
        next.push({
          code,
          name: String(name ?? ""),
          barcode: String(barcode ?? ""),
          units: [{ name: String(unit ?? "حبة"), pack: num(pack, 1), lastPrice: num(price, 0) }],
          cbmPerCarton: num(cbm, 0),
          lastCost: num(cost, 0),
          currency: currency ?? defaultCurrency,
        });
        added++;
      } else {
        const prev = next[at];
        const u0 = prev.units[0] ?? { name: "حبة", pack: 1, lastPrice: 0 };
        next[at] = {
          ...prev,
          name: name === undefined ? prev.name : String(name),
          barcode: barcode === undefined ? prev.barcode : String(barcode),
          units: [
            {
              name: unit === undefined ? u0.name : String(unit),
              pack: num(pack, u0.pack),
              lastPrice: num(price, u0.lastPrice),
            },
            ...prev.units.slice(1),
          ],
          cbmPerCarton: num(cbm, prev.cbmPerCarton),
          lastCost: num(cost, prev.lastCost),
          currency: currency ?? prev.currency,
        };
        updated++;
      }
    }

    if (!added && !updated) return toast.error("لا يوجد عمود «الموديل» في الملف — لم يُستورد شيء");
    setList(next);
    setEditing(true);
    toast.success(
      `تم استيراد ${added + updated} صنف (${added} جديد، ${updated} محدَّث` +
        `${skipped ? `، ${skipped} سطر بلا موديل` : ""}) — اضغط «حفظ» لتثبيتها`,
    );
  };
  const noop = () => {};

  // حارس الإغلاق: «تعديل» هنا يعني قائمة محلية لم تُكتب في التخزين بعد.
  const closeGuard = useCloseGuard({
    dirty: editing && mayWrite,
    title: "دليل الأصناف",
    onSave: mayWrite ? onSave : undefined,
    onDiscard: () => setList(items), // تراجع عن التعديلات المحلية غير المحفوظة
  });

  const actions = [
    {
      icon: FilePlus2,
      label: "جديد",
      color: "text-emerald-600",
      onClick: onNew,
      disabled: !mayWrite,
    },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: noop },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: onSave, disabled: !mayWrite },
    {
      icon: Pencil,
      label: "تعديل",
      color: "text-cyan-600",
      onClick: () => (mayWrite ? setEditing(true) : toast.error("ليس لديك صلاحية لهذا الإجراء")),
      disabled: !mayWrite,
    },
    {
      icon: Trash2,
      label: "حذف",
      color: "text-rose-600",
      onClick: () => toast.info("استخدم زر الحذف في نهاية سطر الصنف"),
    },
    {
      icon: Search,
      label: "بحث",
      color: "text-indigo-500",
      onClick: () => document.getElementById("it-search")?.focus(),
    },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: () => window.print() },
    {
      icon: FileSpreadsheet,
      label: "استيراد Excel",
      color: "text-green-600",
      onClick: onImport,
      disabled: !mayWrite,
    },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    {
      icon: CheckCircle2,
      label: "اعتماد",
      color: "text-emerald-700",
      onClick: onSave,
      disabled: !mayWrite,
    },
    {
      icon: X,
      label: "إغلاق",
      hint: "Esc",
      color: "text-rose-600",
      onClick: closeGuard.requestClose,
    },
  ];

  return (
    <ErpLayout title="دليل الأصناف" ribbon={<Ribbon actions={actions} />}>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={onFile}
        className="hidden"
      />
      <div className="bg-white border border-slate-300 rounded">
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-slate-300"
          style={{ background: "var(--color-erp-panel-header)" }}
        >
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <Package size={16} /> الأصناف ({filtered.length})
          </div>
          <input
            id="it-search"
            placeholder="بحث بالموديل أو الباركود أو الاسم..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-2 py-1 text-xs border border-slate-300 rounded w-72 text-right"
          />
        </div>
        <ErpTable
          headers={[
            "م",
            "الموديل",
            "اسم الصنف",
            "الباركود",
            "الوحدة",
            "العبوة",
            "آخر سعر",
            "العملة",
            "CBM الكرتون",
            "آخر تكلفة (USD)",
            "حذف",
          ]}
        >
          {filtered.map((it, i) => {
            const idx = list.indexOf(it);
            const u0 = it.units[0] ?? { name: "حبة", pack: 1, lastPrice: 0 };
            const cur = it.currency ?? defaultCurrency;
            return (
              <tr key={it.code + i} className="hover:bg-blue-50/40">
                <td className="border border-slate-200 text-center">{i + 1}</td>
                <Cell
                  value={it.code}
                  onChange={(v) => patch(idx, { code: v })}
                  disabled={!canEditRow}
                />
                <Cell
                  value={it.name}
                  onChange={(v) => patch(idx, { name: v })}
                  disabled={!canEditRow}
                  align="right"
                />
                <Cell
                  value={it.barcode}
                  onChange={(v) => patch(idx, { barcode: v })}
                  disabled={!canEditRow}
                />
                <Cell
                  value={u0.name}
                  onChange={(v) => patch(idx, { units: [{ ...u0, name: v }] })}
                  disabled={!canEditRow}
                />
                <Cell
                  value={u0.pack}
                  onChange={(v) => patch(idx, { units: [{ ...u0, pack: parseDecimal(v) }] })}
                  disabled={!canEditRow}
                  align="right"
                />
                <td className="border border-slate-200 text-right px-2 bg-slate-50">
                  {fmt(u0.lastPrice)}
                </td>
                <td className="border border-slate-200 p-0">
                  <select
                    value={cur}
                    disabled={!canEditRow}
                    onChange={(e) => patch(idx, { currency: e.target.value })}
                    className="w-full px-1 py-1 text-xs bg-white disabled:bg-slate-50 border-0 focus:outline-none text-center"
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                </td>
                <Cell
                  value={it.cbmPerCarton}
                  onChange={(v) => patch(idx, { cbmPerCarton: parseDecimal(v) })}
                  disabled={!canEditRow}
                  align="right"
                />
                <td className="border border-slate-200 text-right px-2 bg-slate-50 font-semibold">
                  {fmt(it.lastCost, 4)}
                </td>
                <td className="border border-slate-200 text-center">
                  <button
                    onClick={() => onDelete(idx)}
                    disabled={!mayDelete}
                    title={mayDelete ? "حذف الصنف" : "الحذف يتطلب صلاحية مدير"}
                    className="text-rose-600 hover:bg-rose-50 p-1 rounded disabled:opacity-30"
                  >
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
