import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer,
  FileSpreadsheet, Download, CheckCircle2, X, Plus, Wallet, Building2, Copy,
} from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { Panel, FieldRow, LabelText, ErpInput, ErpSelect, ErpTable, Cell, fmt, fmtInt } from "@/components/erp/ErpUI";
import { erpStore, useErpStore, computePO, savePurchaseOrder } from "@/lib/erp-store";
import type { PurchaseOrder, PORow, Expense } from "@/lib/erp-types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SEED_INVOICE } from "@/lib/erp-seed";
import { upsertSupplier } from "@/lib/erp-store";

export const Route = createFileRoute("/purchase-order")({
  head: () => ({
    meta: [
      { title: "أمر الشراء - نظام ERP" },
      { name: "description", content: "إدارة أوامر الشراء واحتساب التكلفة النهائية" },
      { property: "og:title", content: "أمر الشراء - نظام ERP" },
      { property: "og:description", content: "شاشة إدارة أوامر الشراء" },
    ],
  }),
  component: POPage,
});

const MIN_ROWS = 15;

const blankRows = (count: number): PORow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    model: "",
    name: "",
    unit: "حبة",
    pack: 1,
    qty: 0,
    price: 0,
    cbm: 0,
  }));

const emptyPO = (num: string): PurchaseOrder => ({
  number: num,
  date: new Date().toISOString().slice(0, 10).replace(/-/g, "/"),
  invoiceNo: "",
  supplierCode: "",
  currency: "USD",
  rate: 1,
  containerNo: "",
  containerSize: "40 قدم HQ",
  distributionType: "cbm",
  notes: "",
  rows: blankRows(MIN_ROWS),
  expenses: [],
  approved: false,
});

function POPage() {
  const suppliers = useErpStore((s) => s.suppliers);
  const items = useErpStore((s) => s.items);
  const orders = useErpStore((s) => s.purchaseOrders);

  const [po, setPo] = useState<PurchaseOrder>(orders[0] ?? emptyPO("PO-2024-00001"));
  const [editing, setEditing] = useState(false);
  const [openDlg, setOpenDlg] = useState(false);
  const [supDlg, setSupDlg] = useState(false);
  const [expDlg, setExpDlg] = useState(false);
  const [searchDlg, setSearchDlg] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [markupPct, setMarkupPct] = useState<number>(30);
  const priceTiers = useErpStore((s) => s.settings.priceTiers ?? []);

  const metrics = useMemo(() => computePO(po), [po]);
  const supplier = suppliers.find((s) => s.code === po.supplierCode);

  const disabled = !editing || po.approved;

  const patch = (p: Partial<PurchaseOrder>) => setPo({ ...po, ...p });
  const patchRow = (id: number, p: Partial<PORow>) =>
    setPo({ ...po, rows: po.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const addRow = () =>
    setPo({
      ...po,
      rows: [...po.rows, { id: (po.rows.at(-1)?.id ?? 0) + 1, model: "", name: "", unit: "حبة", pack: 1, qty: 0, price: 0, cbm: 0 }],
    });
  const removeRow = (id: number) => setPo({ ...po, rows: po.rows.filter((r) => r.id !== id) });

  const patchExp = (id: number, p: Partial<Expense>) =>
    setPo({ ...po, expenses: po.expenses.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const addExp = () =>
    setPo({
      ...po,
      expenses: [...po.expenses, { id: (po.expenses.at(-1)?.id ?? 0) + 1, type: "", note: "", currency: po.currency, amount: 0, rate: 1 }],
    });
  const removeExp = (id: number) => setPo({ ...po, expenses: po.expenses.filter((e) => e.id !== id) });

  const onNew = () => {
    const num = `PO-2024-${String(Math.floor(Math.random() * 90000) + 10000)}`;
    setPo(emptyPO(num));
    setEditing(true);
    toast.success("تم إنشاء أمر شراء جديد");
  };
  const onSave = () => {
    if (!po.supplierCode) return toast.error("يجب اختيار المورد");
    const filled = po.rows.filter((r) => r.model || r.name || r.qty > 0);
    if (!filled.length) return toast.error("يجب إضافة صنف واحد على الأقل");
    savePurchaseOrder({ ...po, rows: filled });
    setEditing(false);
    toast.success("تم حفظ أمر الشراء");
  };
  const onEdit = () => { setEditing(true); toast.info("وضع التعديل مفعّل"); };
  const onDelete = () => {
    if (!confirm("حذف أمر الشراء؟")) return;
    erpStore.set({ purchaseOrders: orders.filter((o) => o.number !== po.number) });
    setPo(emptyPO(`PO-2024-${String(Math.floor(Math.random() * 90000) + 10000)}`));
    toast.success("تم الحذف");
  };
  const onApprove = () => {
    const filled = po.rows.filter((r) => r.model || r.name || r.qty > 0);
    if (!po.supplierCode || !filled.length) return toast.error("لا يمكن اعتماد أمر ناقص");
    const approved = { ...po, rows: filled, approved: true };
    setPo(approved);
    savePurchaseOrder(approved);
    setEditing(false);
    toast.success("تم اعتماد أمر الشراء");
  };
  const onImport = () => fileRef.current?.click();
  const onCopy = () => {
    const num = `PO-2024-${String(Math.floor(Math.random() * 90000) + 10000)}`;
    setPo({ ...po, number: num, approved: false, invoiceNo: "" });
    setEditing(true);
    toast.success("تم نسخ الأمر - عدّل ثم احفظ");
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const wb = XLSX.read(await f.arrayBuffer());
    const data = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
    const rows: PORow[] = data.map((r, i) => ({
      id: i + 1,
      model: String(r.model ?? r["الموديل"] ?? ""),
      name: String(r.name ?? r["اسم الصنف"] ?? ""),
      unit: String(r.unit ?? r["الوحدة"] ?? "حبة"),
      pack: Number(r.pack ?? r["العبوة"] ?? 1),
      qty: Number(r.qty ?? r["الكمية"] ?? 0),
      price: Number(r.price ?? r["سعر الشراء"] ?? 0),
      cbm: Number(r.cbm ?? r["CBM"] ?? 0),
    }));
    setPo({ ...po, rows });
    toast.success(`تم استيراد ${rows.length} صنف`);
    e.target.value = "";
  };
  const onExport = () => {
    const data = po.rows.map((r, i) => ({
      "م": i + 1,
      "الموديل": r.model,
      "اسم الصنف": r.name,
      "الوحدة": r.unit,
      "العبوة": r.pack,
      "الكمية": r.qty,
      "سعر الشراء": r.price,
      "تكلفة الشراء": r.qty * r.price,
      "CBM الكرتون": r.cbm,
      "إجمالي CBM": (r.pack ? r.qty / r.pack : 0) * r.cbm,
      "متوسط التكلفة": metrics.rowMetrics[i]?.avgCost ?? 0,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "أمر الشراء");
    XLSX.writeFile(wb, `${po.number}.xlsx`);
    toast.success("تم التصدير إلى Excel");
  };

  const onLoadSeed = async () => {
    const supCode = "PCIU8480987";
    await upsertSupplier({
      code: supCode, name: "المورد الصيني - حاوية PCIU8480987",
      country: "الصين", city: "قوانغجو", phone: "", email: "",
      currency: "USD", notes: "بيانات مستوردة من فاتورة العرض", active: true,
    });
    const seeded: PurchaseOrder = {
      number: `PO-DEMO-${Date.now().toString().slice(-5)}`,
      date: new Date().toISOString().slice(0, 10).replace(/-/g, "/"),
      invoiceNo: supCode,
      supplierCode: supCode,
      currency: "USD",
      rate: 1,
      containerNo: supCode,
      containerSize: "40 قدم HQ",
      distributionType: "avg",
      notes: "الاتفاق: 30% قبل التصنيع، 30% عند التحميل، 40% قبل وصول الميناء",
      rows: SEED_INVOICE.rows.map((r, i) => ({
        id: i + 1, model: r.model, name: r.name, unit: "حبة",
        pack: r.pack, qty: r.qty, price: r.price, cbm: r.cbm,
      })),
      expenses: SEED_INVOICE.expenses.map((e, i) => ({
        id: i + 1, type: e.type, note: e.note,
        currency: e.currency, amount: e.amount, rate: e.rate,
      })),
      approved: false,
    };
    setPo(seeded);
    setEditing(true);
    toast.success(`تم تحميل بيانات العرض (${seeded.rows.length} صنف، ${seeded.expenses.length} مصروف)`);
  };

  const actions = [
    { icon: FilePlus2, label: "جديد", hint: "Ctrl+N", color: "text-emerald-600", onClick: onNew },
    { icon: Copy, label: "نسخ", hint: "Ctrl+D", color: "text-purple-600", onClick: onCopy },
    { icon: FolderOpen, label: "فتح", hint: "Ctrl+O", color: "text-amber-500", onClick: () => setOpenDlg(true) },
    { icon: Save, label: "حفظ", hint: "Ctrl+S", color: "text-blue-600", onClick: onSave, disabled: !editing },
    { icon: Pencil, label: "تعديل", hint: "F2", color: "text-cyan-600", onClick: onEdit, disabled: po.approved },
    { icon: Trash2, label: "حذف", hint: "Del", color: "text-rose-600", onClick: onDelete },
    { icon: Search, label: "بحث", hint: "F3", color: "text-indigo-500", onClick: () => setSearchDlg(true) },
    { icon: Printer, label: "طباعة", hint: "Ctrl+P", color: "text-slate-600", onClick: () => window.print() },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: onImport, disabled },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    { icon: Wallet, label: "المصروفات", hint: "F4", color: "text-orange-600", onClick: () => setExpDlg(true) },
    { icon: CheckCircle2, label: "اعتماد", hint: "F9", color: "text-emerald-700", onClick: onApprove, disabled: po.approved },
    { icon: FileSpreadsheet, label: "بيانات العرض", color: "text-fuchsia-600", onClick: onLoadSeed },
    { icon: X, label: "إغلاق", hint: "Esc", color: "text-rose-600", onClick: () => history.back() },
  ];

  // Windows-like keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "s") { e.preventDefault(); if (editing) onSave(); }
      else if (e.ctrlKey && k === "n") { e.preventDefault(); onNew(); }
      else if (e.ctrlKey && k === "o") { e.preventDefault(); setOpenDlg(true); }
      else if (e.ctrlKey && k === "p") { e.preventDefault(); window.print(); }
      else if (e.key === "F2") { e.preventDefault(); if (!po.approved) onEdit(); }
      else if (e.key === "F3") { e.preventDefault(); setSearchDlg(true); }
      else if (e.key === "F4") { e.preventDefault(); setExpDlg(true); }
      else if (e.key === "F9") { e.preventDefault(); if (!po.approved) onApprove(); }
      else if (e.ctrlKey && k === "d") { e.preventDefault(); onCopy(); }
      else if (e.key === "Escape") { setOpenDlg(false); setSupDlg(false); setExpDlg(false); setSearchDlg(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po, editing]);

  return (
    <ErpLayout title="أمر شراء" ribbon={<Ribbon actions={actions} />}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <Panel title="بيانات المورد">
          <div className="flex gap-3 items-start">
            <div className="w-16 h-20 bg-slate-100 border border-slate-300 rounded flex items-center justify-center text-slate-400 shrink-0">
              <Building2 size={36} strokeWidth={1.2} />
            </div>
            <div className="flex-1 space-y-1.5">
              <FieldRow label="المورد">
                <div className="flex gap-1">
                  <ErpInput value={supplier?.name ?? ""} onChange={() => {}} disabled />
                  <button disabled={disabled} onClick={() => setSupDlg(true)} className="px-2 border border-slate-300 bg-slate-50 rounded disabled:opacity-40"><Search size={13} /></button>
                </div>
              </FieldRow>
              <FieldRow label="كود المورد"><ErpInput value={po.supplierCode} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="الدولة"><ErpInput value={supplier?.country ?? ""} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="المدينة"><ErpInput value={supplier?.city ?? ""} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="الهاتف"><ErpInput value={supplier?.phone ?? ""} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="البريد"><ErpInput value={supplier?.email ?? ""} onChange={() => {}} disabled /></FieldRow>
            </div>
          </div>
        </Panel>

        <Panel title="بيانات أمر الشراء">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <FieldRow label="رقم الأمر"><ErpInput value={po.number} onChange={(v) => patch({ number: v })} disabled={po.approved} /></FieldRow>
            <FieldRow label="التاريخ"><ErpInput value={po.date} onChange={(v) => patch({ date: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="رقم الفاتورة"><ErpInput value={po.invoiceNo} onChange={(v) => patch({ invoiceNo: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="العملة">
              <ErpSelect value={po.currency} onChange={(v) => patch({ currency: v })} disabled={disabled} options={[
                { value: "USD", label: "USD - دولار أمريكي" },
                { value: "EUR", label: "EUR - يورو" },
                { value: "SAR", label: "SAR - ريال سعودي" },
                { value: "AED", label: "AED - درهم إماراتي" },
                { value: "JOD", label: "JOD - دينار أردني" },
              ]} />
            </FieldRow>
            <FieldRow label="سعر الصرف"><ErpInput value={String(po.rate)} onChange={(v) => patch({ rate: Number(v) || 0 })} disabled={disabled} /></FieldRow>
            <FieldRow label="رقم الحاوية"><ErpInput value={po.containerNo} onChange={(v) => patch({ containerNo: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="حجم الحاوية"><ErpInput value={po.containerSize} onChange={(v) => patch({ containerSize: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="توزيع المصروفات">
              <ErpSelect value={po.distributionType} onChange={(v) => patch({ distributionType: v as any })} disabled={disabled} options={[
                { value: "cbm", label: "حسب CBM" },
                { value: "value", label: "حسب قيمة الشراء" },
                { value: "qty", label: "حسب الكمية" },
              ]} />
            </FieldRow>
            <FieldRow label="نسبة المصروفات %">
              <ErpInput
                value={`${fmt(metrics.totalPurchase > 0 ? (metrics.totalExpenses / metrics.totalPurchase) * 100 : 0, 2)} %`}
                onChange={() => {}}
                disabled
                highlight
              />
            </FieldRow>
            <FieldRow label="نسبة الربح %">
              <ErpInput value={String(markupPct)} onChange={(v) => setMarkupPct(Number(v) || 0)} disabled={disabled} />
            </FieldRow>
            <div className="col-span-2">
              <FieldRow label="الملاحظات">
                <textarea value={po.notes} onChange={(e) => patch({ notes: e.target.value })} disabled={disabled} className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:bg-slate-50 min-h-[50px]" />
              </FieldRow>
            </div>
          </div>
        </Panel>
      </div>

      {/* Items */}
      <div className="bg-white border border-slate-300 rounded">
        <div className="flex items-center justify-between px-2 py-1 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
          <div className="flex items-center gap-1">
            <button onClick={addRow} disabled={disabled} className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-emerald-50 disabled:opacity-40">
              <Plus size={12} className="text-emerald-600" /> إضافة صنف
            </button>
            <button onClick={() => po.rows.length && removeRow(po.rows[po.rows.length - 1].id)} disabled={disabled} className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-rose-50 disabled:opacity-40">
              <Trash2 size={12} className="text-rose-600" /> حذف
            </button>
          </div>
          <div className="font-semibold text-slate-700">جدول الأصناف</div>
          <div className="text-xs text-slate-500">{po.approved && <span className="text-emerald-600 font-semibold">✓ معتمد</span>}</div>
        </div>
        <ErpTable headers={["م","الموديل","اسم الصنف","الوحدة","العبوة","الكمية","سعر الشراء","تكلفة الشراء","CBM الكرتون","إجمالي CBM","تكلفة CBM","متوسط التكلفة","إجمالي التكلفة","التكلفة %","سعر البيع"]}>
          {(() => {
            const displayRows = po.rows.length >= MIN_ROWS
              ? po.rows
              : [...po.rows, ...blankRows(MIN_ROWS - po.rows.length).map((r, k) => ({ ...r, id: (po.rows.at(-1)?.id ?? 0) + k + 1 }))];
            return displayRows.map((r, i) => {
            const m = metrics.rowMetrics[i];
            const salePrice = (m?.avgCost ?? 0) * (1 + markupPct / 100);
            return (
              <tr key={r.id} className="hover:bg-blue-50/40 odd:bg-white even:bg-slate-50/40">
                <td className="border border-slate-200 text-center px-1 font-semibold text-slate-500 bg-slate-100/60 w-10">{i + 1}</td>
                <Cell value={r.model} onChange={(v) => {
                  const it = items.find((x) => x.code === v || x.barcode === v);
                  if (it) patchRow(r.id, { model: it.code, name: it.name, cbm: it.cbmPerCarton, unit: it.units[0]?.name ?? "حبة", pack: it.units[0]?.pack ?? 1, price: it.units[0]?.lastPrice ?? 0 });
                  else patchRow(r.id, { model: v });
                }} disabled={disabled} />
                <Cell value={r.name} onChange={(v) => patchRow(r.id, { name: v })} disabled={disabled} align="right" />
                <Cell value={r.unit} onChange={(v) => patchRow(r.id, { unit: v })} disabled={disabled} />
                <Cell value={String(r.pack)} onChange={(v) => patchRow(r.id, { pack: Number(v) || 0 })} disabled={disabled} align="right" />
                <Cell value={String(r.qty)} onChange={(v) => patchRow(r.id, { qty: Number(v) || 0 })} disabled={disabled} align="right" />
                <Cell value={String(r.price)} onChange={(v) => patchRow(r.id, { price: Number(v) || 0 })} disabled={disabled} align="right" />
                <Cell value={fmt(m?.linePurchase ?? 0)} />
                <Cell value={String(r.cbm)} onChange={(v) => patchRow(r.id, { cbm: Number(v) || 0 })} disabled={disabled} align="right" />
                <Cell value={fmt(m?.lineCBM ?? 0, 4)} />
                <Cell value={fmt(m?.cbmCost ?? 0, 4)} />
                <td className="border border-slate-200 px-2 py-1 text-right bg-amber-50 font-semibold">{fmt(m?.avgCost ?? 0, 4)}</td>
                <td className="border border-slate-200 px-2 py-1 text-right bg-amber-50/60 font-semibold">{fmt(m?.lineTotalCost ?? 0)}</td>
                <td className="border border-slate-200 px-2 py-1 text-right">{fmt(m?.pctCost ?? 0, 2)}%</td>
                <td className="border border-slate-200 px-2 py-1 text-right bg-emerald-50 font-semibold text-emerald-700">{fmt(salePrice, 4)}</td>
              </tr>
            );
          }); })()}
          <tr className="font-bold" style={{ background: "var(--color-erp-panel-header)" }}>
            <td className="border border-slate-300 text-center">*</td>
            <td className="border border-slate-300" colSpan={4}></td>
            <td className="border border-slate-300 text-right px-2">{fmtInt(metrics.totalQty)}</td>
            <td className="border border-slate-300"></td>
            <td className="border border-slate-300 text-right px-2">{fmt(metrics.totalPurchase)}</td>
            <td className="border border-slate-300"></td>
            <td className="border border-slate-300 text-right px-2">{fmt(metrics.totalCBM, 4)}</td>
            <td className="border border-slate-300"></td>
            <td className="border border-slate-300"></td>
            <td className="border border-slate-300 text-right px-2">{fmt(metrics.totalCost)}</td>
            <td className="border border-slate-300 text-right px-2">{fmt(metrics.totalPurchase > 0 ? (metrics.totalExpenses / metrics.totalPurchase) * 100 : 0, 2)}%</td>
            <td className="border border-slate-300"></td>
          </tr>
        </ErpTable>
      </div>

      {/* Expenses */}
      <div className="bg-white border border-slate-300 rounded">
        <div className="flex items-center justify-between px-2 py-1 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
          <div className="flex items-center gap-1">
            <button onClick={addExp} disabled={disabled} className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-emerald-50 disabled:opacity-40">
              <Plus size={12} className="text-emerald-600" /> إضافة مصروف
            </button>
          </div>
          <div className="font-semibold text-slate-700 flex items-center gap-1"><Wallet size={14} /> المصروفات</div>
          <div className="text-xs text-slate-600">الإجمالي: <span className="font-bold">{fmt(metrics.totalExpenses)}</span> {po.currency}</div>
        </div>
        <ErpTable headers={["م","نوع المصروف","البيان","العملة","المبلغ","سعر الصرف","القيمة بعملة الفاتورة",""]}>
          {po.expenses.map((e, i) => (
            <tr key={e.id} className="hover:bg-blue-50/40">
              <td className="border border-slate-200 text-center">{i + 1}</td>
              <Cell value={e.type} onChange={(v) => patchExp(e.id, { type: v })} disabled={disabled} align="right" />
              <Cell value={e.note} onChange={(v) => patchExp(e.id, { note: v })} disabled={disabled} align="right" />
              <Cell value={e.currency} onChange={(v) => patchExp(e.id, { currency: v })} disabled={disabled} />
              <Cell value={String(e.amount)} onChange={(v) => patchExp(e.id, { amount: Number(v) || 0 })} disabled={disabled} align="right" />
              <Cell value={String(e.rate)} onChange={(v) => patchExp(e.id, { rate: Number(v) || 0 })} disabled={disabled} align="right" />
              <Cell value={fmt(e.amount * (e.rate || 1))} />
              <td className="border border-slate-200 text-center">
                <button disabled={disabled} onClick={() => removeExp(e.id)} className="text-rose-600 hover:bg-rose-50 p-1 rounded disabled:opacity-40"><Trash2 size={12} /></button>
              </td>
            </tr>
          ))}
        </ErpTable>
      </div>

      {/* Summary */}
      <div className="bg-white border border-slate-300 rounded">
        <div className="text-center py-1 font-semibold text-slate-700 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>ملخص أمر الشراء</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 p-2">
          <SummaryStat label="عدد الأصناف" value={fmtInt(metrics.totalItems)} unit="صنف" />
          <SummaryStat label="إجمالي الكمية" value={fmtInt(metrics.totalQty)} />
          <SummaryStat label="إجمالي الشراء" value={fmt(metrics.totalPurchase)} unit={po.currency} />
          <SummaryStat label="إجمالي CBM" value={fmt(metrics.totalCBM, 4)} unit="CBM" />
          <SummaryStat label="إجمالي المصروفات" value={fmt(metrics.totalExpenses)} unit={po.currency} />
          <SummaryStat label="سعر CBM" value={fmt(metrics.cbmPrice)} unit={po.currency} />
          <SummaryStat label="إجمالي التكلفة" value={fmt(metrics.totalCost)} unit={po.currency} highlight />
        </div>
      </div>

      {/* Price tiers */}
      {priceTiers.length > 0 && (
        <div className="bg-white border border-slate-300 rounded">
          <div className="text-center py-1 font-semibold text-slate-700 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
            التسعيرات حسب الوجهات (تُدار من شاشة الإعدادات)
          </div>
          <ErpTable headers={["م", "الموديل", "اسم الصنف", "متوسط التكلفة", ...priceTiers.flatMap((t) => [`تكلفة ${t.name}`, `بيع ${t.name}`])]}>
            {po.rows.filter((r) => r.model || r.name).map((r, i) => {
              const m = metrics.rowMetrics[i];
              const avg = m?.avgCost ?? 0;
              return (
                <tr key={r.id} className="odd:bg-white even:bg-slate-50/50">
                  <td className="border border-slate-200 text-center text-slate-500 w-10">{i + 1}</td>
                  <td className="border border-slate-200 text-center px-2">{r.model}</td>
                  <td className="border border-slate-200 text-right px-2">{r.name}</td>
                  <td className="border border-slate-200 text-right px-2 bg-amber-50 font-semibold">{fmt(avg, 4)}</td>
                  {priceTiers.flatMap((t) => {
                    const tierCost = avg * (1 + (t.extraPct || 0) / 100);
                    const salePrice = tierCost * (1 + (t.profitPct || 0) / 100);
                    return [
                      <td key={t.id + "c"} className="border border-slate-200 text-right px-2">{fmt(tierCost, 4)}</td>,
                      <td key={t.id + "s"} className="border border-slate-200 text-right px-2 bg-emerald-50 font-semibold text-emerald-700">{fmt(salePrice, 4)}</td>,
                    ];
                  })}
                </tr>
              );
            })}
          </ErpTable>
        </div>
      )}

      {/* Dialogs */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>فتح أمر شراء</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-auto space-y-1">
            {orders.map((o) => (
              <button key={o.number} onClick={() => { setPo(o); setOpenDlg(false); setEditing(false); }} className="w-full text-right px-3 py-2 border border-slate-200 rounded hover:bg-blue-50 flex justify-between">
                <span className="text-xs text-slate-500">{o.date}</span>
                <span className="font-semibold">{o.number}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={supDlg} onOpenChange={setSupDlg}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>اختيار المورد</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-auto space-y-1">
            {suppliers.filter((s) => s.active).map((s) => (
              <button key={s.code} onClick={() => { patch({ supplierCode: s.code, currency: s.currency }); setSupDlg(false); }} className="w-full text-right px-3 py-2 border border-slate-200 rounded hover:bg-blue-50">
                <div className="font-semibold">{s.name}</div>
                <div className="text-xs text-slate-500">{s.code} • {s.country}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={searchDlg} onOpenChange={setSearchDlg}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>البحث في الأصناف</DialogTitle></DialogHeader>
          <input placeholder="موديل، باركود، أو اسم..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-right" />
          <div className="max-h-64 overflow-auto space-y-1">
            {items.filter((it) => !searchTerm || it.name.includes(searchTerm) || it.code.includes(searchTerm) || it.barcode.includes(searchTerm)).map((it) => (
              <button key={it.code} onClick={() => {
                addRow();
                setTimeout(() => setPo((cur) => {
                  const last = cur.rows[cur.rows.length - 1];
                  return { ...cur, rows: cur.rows.map((r) => r.id === last.id ? { ...r, model: it.code, name: it.name, cbm: it.cbmPerCarton, unit: it.units[0]?.name ?? "حبة", pack: it.units[0]?.pack ?? 1, price: it.units[0]?.lastPrice ?? 0 } : r) };
                }), 0);
                setSearchDlg(false);
              }} className="w-full text-right p-2 border border-slate-200 rounded hover:bg-blue-50">
                <div className="font-semibold">{it.name}</div>
                <div className="text-xs text-slate-500">{it.code} • {it.barcode}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}

function SummaryStat({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: boolean }) {
  return (
    <div className={`border rounded p-2 text-center shadow-sm ${highlight ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"}`}>
      <div className="text-[11px] text-slate-600">{label}</div>
      <div className="text-lg font-bold text-slate-800 leading-tight">{value}</div>
      {unit && <div className="text-[10px] text-slate-500">{unit}</div>}
    </div>
  );
}