import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  FilePlus2,
  Save,
  Copy,
  FolderOpen,
  Pencil,
  Trash2,
  Search,
  Printer,
  FileSpreadsheet,
  Wallet,
  CheckCircle2,
  LogOut,
  Plus,
  Ruler,
  Settings2,
  Building2,
  Package,
  Boxes,
  ShoppingCart,
  Box,
  Receipt,
  Calculator,
  DollarSign,
  TrendingUp,
  Minus,
  Square,
  X,
  Calendar,
  Circle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Row = {
  id: number;
  model: string;
  barcode: string;
  name: string;
  unit: string;
  pack: number;
  cartons: number;
  qty: number;
  price: number;
  cbm: number;
};

const INITIAL_ROWS: Row[] = [
  { id: 1, model: "MOD-1001", barcode: "6921547856321", name: "سماعة بلوتوث A10", unit: "حبة", pack: 24, cartons: 10, qty: 240, price: 4.5, cbm: 0.06 },
  { id: 2, model: "MOD-1002", barcode: "6921547856322", name: "شاحن سريع 20W", unit: "حبة", pack: 20, cartons: 24, qty: 480, price: 3.2, cbm: 0.04 },
  { id: 3, model: "MOD-1003", barcode: "6921547856323", name: "كابل بيانات Type-C", unit: "حبة", pack: 15, cartons: 100, qty: 1500, price: 1.1, cbm: 0.02 },
  { id: 4, model: "MOD-1004", barcode: "6921547856324", name: "باور بانك 10000mAh", unit: "حبة", pack: 12, cartons: 20, qty: 240, price: 6.8, cbm: 0.08 },
  { id: 5, model: "MOD-1005", barcode: "6921547856325", name: "سماعة سلكية Y20", unit: "حبة", pack: 8, cartons: 50, qty: 400, price: 2.0, cbm: 0.03 },
];

const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (n: number) => n.toLocaleString("en-US");

export default function PurchaseOrderScreen() {
  const [supplier, setSupplier] = useState({
    code: "SUP0001",
    name: "شركة الأمل للتجارة",
    currency: "USD - دولار أمريكي",
    rate: 3.75,
    phone: "+962 79 000 0000",
    country: "الأردن",
    address: "عمّان - شارع الملكة رانيا",
  });

  const [order, setOrder] = useState({
    number: "PO-2024-00056",
    date: "2024/05/19",
    invoice: "INV-2024-0487",
    container: "TCLU1234567",
  });

  const [rows, setRows] = useState<Row[]>(INITIAL_ROWS);
  const [expenses, setExpenses] = useState(132.72);
  const [approved, setApproved] = useState(false);
  const [editing, setEditing] = useState(true);

  const [openDialog, setOpenDialog] = useState(false);
  const [expensesDialog, setExpensesDialog] = useState(false);
  const [searchDialog, setSearchDialog] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totals = useMemo(() => {
    const totalItems = rows.length;
    const totalCartons = rows.reduce((s, r) => s + (r.cartons || 0), 0);
    const totalQty = rows.reduce((s, r) => s + (r.qty || 0), 0);
    const totalValue = rows.reduce((s, r) => s + r.qty * r.price, 0);
    const totalCBM = rows.reduce((s, r) => s + r.cartons * r.cbm, 0);
    const cbmPrice = totalCBM > 0 ? expenses / totalCBM : 0;
    const totalCost = totalValue + expenses;
    const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
    return { totalItems, totalCartons, totalQty, totalValue, totalCBM, cbmPrice, totalCost, avgCost };
  }, [rows, expenses]);

  const rowExtras = (r: Row) => {
    const lineTotal = r.qty * r.price;
    const lineCBM = r.cartons * r.cbm;
    const cartonCost = r.pack ? r.price * r.pack : 0;
    const avg = r.qty ? (lineTotal + (totals.totalCBM ? (lineCBM / totals.totalCBM) * expenses : 0)) / r.qty : 0;
    return { lineTotal, lineCBM, cartonCost, avg };
  };

  const updateRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addRow = () =>
    setRows((rs) => [
      ...rs,
      {
        id: (rs.at(-1)?.id ?? 0) + 1,
        model: "",
        barcode: "",
        name: "",
        unit: "حبة",
        pack: 0,
        cartons: 0,
        qty: 0,
        price: 0,
        cbm: 0,
      },
    ]);

  // Toolbar actions
  const onNew = () => {
    setRows([]);
    setOrder({
      number: `PO-2024-${String(Math.floor(Math.random() * 90000) + 10000)}`,
      date: new Date().toISOString().slice(0, 10).replace(/-/g, "/"),
      invoice: "",
      container: "",
    });
    setExpenses(0);
    setApproved(false);
    setEditing(true);
    toast.success("تم إنشاء أمر شراء جديد");
  };
  const onSave = () => toast.success("تم حفظ أمر الشراء بنجاح");
  const onCopy = () => {
    setOrder((o) => ({ ...o, number: `PO-2024-${String(Math.floor(Math.random() * 90000) + 10000)}` }));
    toast.success("تم نسخ أمر الشراء برقم جديد");
  };
  const onDelete = () => {
    if (confirm("هل أنت متأكد من حذف هذا الأمر؟")) {
      setRows([]);
      toast.success("تم حذف أمر الشراء");
    }
  };
  const onPrint = () => window.print();
  const onApprove = () => {
    setApproved(true);
    setEditing(false);
    toast.success("تم اعتماد أمر الشراء");
  };
  const onExit = () => {
    if (confirm("هل تريد الخروج من الشاشة؟")) toast.info("تم إغلاق الشاشة");
  };

  const onImportExcel = () => fileInputRef.current?.click();
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<any>(sheet);
    const imported: Row[] = data.map((r, i) => ({
      id: i + 1,
      model: String(r.model ?? r["الموديل"] ?? ""),
      barcode: String(r.barcode ?? r["الباركود"] ?? ""),
      name: String(r.name ?? r["اسم الصنف"] ?? ""),
      unit: String(r.unit ?? r["الوحدة"] ?? "حبة"),
      pack: Number(r.pack ?? r["العبوة"] ?? 0),
      cartons: Number(r.cartons ?? r["الكراتين"] ?? 0),
      qty: Number(r.qty ?? r["الكمية"] ?? 0),
      price: Number(r.price ?? r["سعر الشراء"] ?? 0),
      cbm: Number(r.cbm ?? r["CBM"] ?? 0),
    }));
    if (imported.length) {
      setRows(imported);
      toast.success(`تم استيراد ${imported.length} صنف من Excel`);
    }
    e.target.value = "";
  };

  const tools = [
    { icon: FilePlus2, label: "جديد", color: "text-emerald-600", onClick: onNew },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: onSave },
    { icon: Copy, label: "نسخ", color: "text-sky-600", onClick: onCopy },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: () => setOpenDialog(true) },
    { icon: Pencil, label: "تعديل", color: "text-cyan-600", onClick: () => { setEditing(true); toast.info("وضع التعديل مفعّل"); } },
    { icon: Trash2, label: "حذف", color: "text-rose-600", onClick: onDelete },
    { icon: Search, label: "بحث", color: "text-indigo-500", onClick: () => setSearchDialog(true) },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: onPrint },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: onImportExcel },
    { icon: Wallet, label: "المصاريف", color: "text-amber-600", onClick: () => setExpensesDialog(true) },
    { icon: CheckCircle2, label: "اعتماد", color: "text-emerald-600", onClick: onApprove },
    { icon: LogOut, label: "خروج", color: "text-rose-600", onClick: onExit },
  ];

  return (
    <div className="min-h-screen font-sans text-[13px] text-slate-800" style={{ background: "var(--color-erp-bg)" }} dir="rtl">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 h-9 text-white" style={{ background: "var(--color-erp-titlebar)" }}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-white/20 flex items-center justify-center text-[10px] font-bold">ERP</div>
          <span className="text-sm font-semibold">نظام تخطيط موارد المؤسسات</span>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold">أمر شراء</div>
        <div className="flex items-center gap-1">
          <button className="w-8 h-7 hover:bg-white/10 flex items-center justify-center"><Minus size={14} /></button>
          <button className="w-8 h-7 hover:bg-white/10 flex items-center justify-center"><Square size={12} /></button>
          <button className="w-8 h-7 hover:bg-rose-600 flex items-center justify-center"><X size={14} /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-end bg-gradient-to-b from-slate-100 to-slate-200 border-b border-slate-300 px-1 pt-1">
        {["ملف", "أوامر الشراء", "الموردون", "الأصناف", "التقارير", "الفواتير", "الإعدادات", "المساعدة"].map((t, i) => (
          <button
            key={t}
            className={`px-4 py-1.5 text-[13px] border border-b-0 rounded-t-md ml-1 ${
              i === 1
                ? "bg-white border-slate-300 font-semibold text-blue-700"
                : "bg-slate-100 border-transparent hover:bg-white/70 text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Ribbon toolbar */}
      <div className="bg-white border-b border-slate-300 px-2 py-1.5 flex items-stretch gap-0.5 overflow-x-auto">
        {tools.map((t, i) => (
          <button
            key={i}
            onClick={t.onClick}
            className="flex flex-col items-center justify-center px-3 py-1 min-w-[64px] rounded hover:bg-blue-50 transition-colors"
          >
            <t.icon size={26} className={t.color} strokeWidth={1.6} />
            <span className="text-[11px] mt-0.5 text-slate-700">{t.label}</span>
          </button>
        ))}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
      </div>

      <div className="p-2 space-y-2">
        {/* Two panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {/* Supplier panel */}
          <Panel title="بيانات المورد">
            <div className="flex gap-3 items-center">
              <div className="w-20 h-24 bg-slate-100 border border-slate-300 rounded flex items-center justify-center text-slate-400">
                <Building2 size={44} strokeWidth={1.2} />
              </div>
              <div className="flex-1 space-y-1.5">
                <FieldRow label="كود المورد">
                  <div className="flex">
                    <ErpInput value={supplier.code} onChange={(v) => setSupplier({ ...supplier, code: v })} disabled={!editing} className="rounded-l-none" />
                    <button className="px-2 border border-r-0 border-slate-300 bg-slate-50 rounded-l"><Search size={13} /></button>
                  </div>
                </FieldRow>
                <FieldRow label="اسم المورد">
                  <ErpInput value={supplier.name} onChange={(v) => setSupplier({ ...supplier, name: v })} disabled={!editing} />
                </FieldRow>
                <FieldRow label="العملة">
                  <ErpInput value={supplier.currency} onChange={(v) => setSupplier({ ...supplier, currency: v })} disabled={!editing} />
                </FieldRow>
                <FieldRow label="سعر الصرف">
                  <ErpInput value={String(supplier.rate)} onChange={(v) => setSupplier({ ...supplier, rate: Number(v) || 0 })} disabled={!editing} align="right" />
                </FieldRow>
                <FieldRow label="الهاتف">
                  <ErpInput value={supplier.phone} onChange={(v) => setSupplier({ ...supplier, phone: v })} disabled={!editing} />
                </FieldRow>
                <FieldRow label="الدولة">
                  <ErpInput value={supplier.country} onChange={(v) => setSupplier({ ...supplier, country: v })} disabled={!editing} />
                </FieldRow>
                <FieldRow label="العنوان">
                  <ErpInput value={supplier.address} onChange={(v) => setSupplier({ ...supplier, address: v })} disabled={!editing} />
                </FieldRow>
              </div>
            </div>
          </Panel>

          {/* Order panel */}
          <Panel title="بيانات أمر الشراء">
            <div className="grid grid-cols-[110px_1fr_1fr] gap-2 items-start">
              <div className="space-y-1.5 col-span-1">
                <LabelText>رقم الأمر</LabelText>
                <LabelText>التاريخ</LabelText>
                <LabelText>رقم الفاتورة</LabelText>
                <LabelText>رقم الحاوية</LabelText>
                <LabelText>إجمالي CBM</LabelText>
                <LabelText>سعر CBM</LabelText>
              </div>
              <div className="space-y-1.5">
                <ErpInput value={order.number} onChange={(v) => setOrder({ ...order, number: v })} disabled={!editing || approved} />
                <div className="flex">
                  <ErpInput value={order.date} onChange={(v) => setOrder({ ...order, date: v })} disabled={!editing} className="rounded-l-none" />
                  <button className="px-2 border border-r-0 border-slate-300 bg-slate-50 rounded-l"><Calendar size={13} /></button>
                </div>
                <ErpInput value={order.invoice} onChange={(v) => setOrder({ ...order, invoice: v })} disabled={!editing} />
                <ErpInput value={order.container} onChange={(v) => setOrder({ ...order, container: v })} disabled={!editing} />
                <ErpInput value={fmt(totals.totalCBM, 4)} onChange={() => {}} disabled highlight align="right" />
                <ErpInput value={fmt(totals.cbmPrice, 2)} onChange={() => {}} disabled highlight align="right" />
              </div>
              <div className="border border-slate-300 rounded bg-slate-50 h-full min-h-[220px] p-2 text-xs text-slate-500">
                ملاحظات: {approved && <span className="text-emerald-600 font-semibold">✓ الأمر معتمد</span>}
              </div>
            </div>
          </Panel>
        </div>

        {/* Items table */}
        <div className="bg-white border border-slate-300 rounded">
          <div className="flex items-center justify-between px-2 py-1 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
            <div className="flex items-center gap-1">
              <button onClick={addRow} className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-emerald-50">
                <Plus size={12} className="text-emerald-600" /> إضافة صنف
              </button>
              <button onClick={() => rows.length && removeRow(rows[rows.length - 1].id)} className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-rose-50">
                <Trash2 size={12} className="text-rose-600" /> حذف
              </button>
              <button className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-blue-50">
                <Ruler size={12} className="text-blue-600" /> الوحدات
              </button>
            </div>
            <div className="font-semibold text-slate-700">جدول الأصناف</div>
            <div className="flex items-center gap-2">
              <div className="flex items-center border border-slate-300 rounded bg-white">
                <input placeholder="اكتب للبحث..." className="px-2 py-1 text-xs outline-none w-40 text-right" />
                <button className="px-2 border-r border-slate-300"><Search size={12} /></button>
              </div>
              <button className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded"><Settings2 size={12} /> إعدادات الأعمدة</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-slate-700" style={{ background: "var(--color-erp-table-header)" }}>
                  {["م","الموديل","الباركود","اسم الصنف","الوحدة","العبوة","الكراتين","الكمية","سعر الشراء","إجمالي الشراء","CBM","إجمالي CBM","تكلفة الكرتون","متوسط التكلفة"].map(h => (
                    <th key={h} className="border border-slate-300 px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const ex = rowExtras(r);
                  return (
                    <tr key={r.id} className="hover:bg-blue-50/40">
                      <td className="border border-slate-200 text-center px-1 py-1">{i + 1}</td>
                      <Cell value={r.model} onChange={(v) => updateRow(r.id, { model: v })} disabled={!editing} />
                      <Cell value={r.barcode} onChange={(v) => updateRow(r.id, { barcode: v })} disabled={!editing} />
                      <Cell value={r.name} onChange={(v) => updateRow(r.id, { name: v })} disabled={!editing} align="right" />
                      <Cell value={r.unit} onChange={(v) => updateRow(r.id, { unit: v })} disabled={!editing} />
                      <Cell value={String(r.pack)} onChange={(v) => updateRow(r.id, { pack: Number(v) || 0 })} disabled={!editing} align="right" />
                      <Cell value={String(r.cartons)} onChange={(v) => updateRow(r.id, { cartons: Number(v) || 0 })} disabled={!editing} align="right" />
                      <Cell value={fmtInt(r.qty)} onChange={(v) => updateRow(r.id, { qty: Number(v.replace(/,/g, "")) || 0 })} disabled={!editing} align="right" />
                      <Cell value={fmt(r.price)} onChange={(v) => updateRow(r.id, { price: Number(v) || 0 })} disabled={!editing} align="right" />
                      <td className="border border-slate-200 px-2 py-1 text-right bg-slate-50">{fmt(ex.lineTotal)}</td>
                      <Cell value={fmt(r.cbm, 4)} onChange={(v) => updateRow(r.id, { cbm: Number(v) || 0 })} disabled={!editing} align="right" />
                      <td className="border border-slate-200 px-2 py-1 text-right bg-slate-50">{fmt(ex.lineCBM, 4)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-right bg-slate-50">{fmt(ex.cartonCost)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-right bg-amber-50 font-semibold">{fmt(ex.avg, 4)}</td>
                    </tr>
                  );
                })}
                {/* Totals */}
                <tr className="font-bold" style={{ background: "var(--color-erp-panel-header)" }}>
                  <td className="border border-slate-300 text-center">*</td>
                  <td className="border border-slate-300"></td>
                  <td className="border border-slate-300"></td>
                  <td className="border border-slate-300"></td>
                  <td className="border border-slate-300"></td>
                  <td className="border border-slate-300"></td>
                  <td className="border border-slate-300 text-right px-2">{fmtInt(totals.totalCartons)}</td>
                  <td className="border border-slate-300 text-right px-2">{fmtInt(totals.totalQty)}</td>
                  <td className="border border-slate-300"></td>
                  <td className="border border-slate-300 text-right px-2">{fmt(totals.totalValue)}</td>
                  <td className="border border-slate-300"></td>
                  <td className="border border-slate-300 text-right px-2">{fmt(totals.totalCBM, 4)}</td>
                  <td className="border border-slate-300 text-right px-2">{fmt(rows.reduce((s, r) => s + r.price * r.pack, 0))}</td>
                  <td className="border border-slate-300 text-right px-2">{fmt(totals.avgCost, 4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-white border border-slate-300 rounded">
          <div className="text-center py-1 font-semibold text-slate-700 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
            ملخص أمر الشراء
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 p-2">
            <SummaryCard icon={Package} color="text-blue-600" label="إجمالي الأصناف" value={fmtInt(totals.totalItems)} unit="صنف" />
            <SummaryCard icon={Boxes} color="text-amber-600" label="إجمالي الكراتين" value={fmtInt(totals.totalCartons)} unit="كرتون" />
            <SummaryCard icon={Box} color="text-emerald-600" label="إجمالي الكمية" value={fmtInt(totals.totalQty)} unit="حبة" />
            <SummaryCard icon={ShoppingCart} color="text-green-600" label="إجمالي قيمة الشراء" value={fmt(totals.totalValue)} unit="USD" />
            <SummaryCard icon={Box} color="text-sky-600" label="إجمالي CBM" value={fmt(totals.totalCBM, 4)} unit="CBM" />
            <SummaryCard icon={Receipt} color="text-rose-600" label="إجمالي المصاريف" value={fmt(expenses)} unit="USD" />
            <SummaryCard icon={Calculator} color="text-indigo-600" label="سعر CBM الواحد" value={fmt(totals.cbmPrice)} unit="USD" />
            <SummaryCard icon={DollarSign} color="text-emerald-700" label="إجمالي التكلفة" value={fmt(totals.totalCost)} unit="USD" />
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 text-white text-xs" style={{ background: "var(--color-erp-status)" }}>
        <div className="flex items-center gap-4">
          <span>المستخدم: admin</span>
          <span>الفترة المالية: 2024</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Circle size={8} className="fill-emerald-400 text-emerald-400" /> متصل: الاتصال بقاعدة البيانات</span>
          <span>{new Date().toLocaleTimeString("en-US")}</span>
        </div>
      </div>

      {/* Dialogs */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>فتح أمر شراء</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {["PO-2024-00056", "PO-2024-00055", "PO-2024-00054", "PO-2024-00053"].map((n) => (
              <button key={n} onClick={() => { setOrder({ ...order, number: n }); setOpenDialog(false); toast.success(`تم فتح ${n}`); }} className="w-full text-right px-3 py-2 border border-slate-200 rounded hover:bg-blue-50">
                {n}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={expensesDialog} onOpenChange={setExpensesDialog}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>إدخال المصاريف الإضافية</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>قيمة المصاريف (USD)</Label>
            <Input type="number" value={expenses} onChange={(e) => setExpenses(Number(e.target.value) || 0)} className="text-right" />
          </div>
          <DialogFooter>
            <Button onClick={() => { setExpensesDialog(false); toast.success("تم حفظ المصاريف"); }}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={searchDialog} onOpenChange={setSearchDialog}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>البحث في الأصناف</DialogTitle></DialogHeader>
          <Input placeholder="اكتب اسم الصنف أو الباركود..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="text-right" />
          <div className="max-h-64 overflow-auto space-y-1">
            {rows.filter(r => !searchTerm || r.name.includes(searchTerm) || r.barcode.includes(searchTerm) || r.model.includes(searchTerm)).map(r => (
              <div key={r.id} className="p-2 border border-slate-200 rounded text-sm">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-slate-500">{r.model} • {r.barcode}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-300 rounded">
      <div className="text-center py-1 font-semibold text-slate-700 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
        {title}
      </div>
      <div className="p-2">{children}</div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[90px_1fr] items-center gap-2">
      <LabelText>{label}</LabelText>
      {children}
    </div>
  );
}

function LabelText({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-slate-700 text-left pl-2">{children}</div>;
}

function ErpInput({
  value,
  onChange,
  disabled,
  align = "right",
  highlight,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  align?: "right" | "left" | "center";
  highlight?: boolean;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-700 text-${align} ${highlight ? "!bg-[var(--color-erp-highlight)]" : ""} ${className}`}
    />
  );
}

function Cell({
  value,
  onChange,
  disabled,
  align = "center",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  align?: "right" | "left" | "center";
}) {
  return (
    <td className="border border-slate-200 p-0">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full px-2 py-1 bg-transparent outline-none focus:bg-blue-50 disabled:text-slate-700 text-${align}`}
      />
    </td>
  );
}

function SummaryCard({
  icon: Icon,
  color,
  label,
  value,
  unit,
}: {
  icon: any;
  color: string;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded p-2 text-center shadow-sm">
      <div className="flex items-center justify-center gap-1 text-[11px] text-slate-600 mb-1">
        <Icon size={16} className={color} strokeWidth={1.6} />
        <span>{label}</span>
      </div>
      <div className="text-lg font-bold text-slate-800 leading-tight">{value}</div>
      <div className="text-[10px] text-slate-500">{unit}</div>
    </div>
  );
}