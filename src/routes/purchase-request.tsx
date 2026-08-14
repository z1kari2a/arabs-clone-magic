// شاشة «طلب الشراء» — نفس تفاصيل شاشة أمر الشراء (نفس بيانات المورد، نفس جدول
// البنود بأعمدته، ونفس أعمدة التوزيع الثلاثة)، مع فارق واحد مقصود: لا شاشة
// مصروفات هنا. الطلب مستند تقديري يُعدّ قبل الشراء ولا توجد فواتير مصروفات بعد،
// فيُدخل المستخدم «سعر CBM» و«نسبة المصاريف %» يدوياً ومنهما يُوزَّع كل شيء
// (انظر computePR في src/lib/erp-store.ts).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer,
  FileSpreadsheet, Download, CheckCircle2, X, Plus, Building2, Copy,
  Coins, Package, Info, Check,
} from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { Panel, FieldRow, ErpInput, ErpSelect, ErpTable, Cell, SaleCell, fmt, fmtInt, parseDecimal } from "@/components/erp/ErpUI";
import { printPurchaseRequest } from "@/lib/print-po";
import {
  erpStore, useErpStore, computePR, savePurchaseRequest, deletePurchaseRequest,
  isRealRow, cartonsOf, lineCBMOf,
} from "@/lib/erp-store";
import { getCurrentScope, localDb } from "@/lib/local-db";
import { useAuth, canWrite, canDelete, canApprove } from "@/lib/auth";
import type { PurchaseRequest, PORow } from "@/lib/erp-types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/purchase-request")({
  head: () => ({
    meta: [
      { title: "طلب الشراء - نظام ERP" },
      { name: "description", content: "إعداد طلبات الشراء وتقدير التكلفة قبل الشراء" },
      { property: "og:title", content: "طلب الشراء - نظام ERP" },
      { property: "og:description", content: "شاشة طلبات الشراء" },
    ],
  }),
  component: PRPage,
});

/**
 * الرقم التالي لطلب الشراء، يُقرأ من التخزين لا من القائمة في الذاكرة — نفس
 * منطق أمر الشراء: تسلسلي مع التحقق من عدم وجوده، حتى لا يكتب طلب جديد فوق
 * طلب قديم يحمل الرقم نفسه. البادئة REQ مستقلة عن INV فلا تتداخل الترقيمات.
 */
const nextRequestNumber = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const prefix = `REQ-${year}-`;
  const existing = new Set((await localDb.purchaseRequests.list()).map((r) => r.number));
  let seq = 0;
  for (const num of existing) {
    if (!num.startsWith(prefix)) continue;
    const parsed = Number(num.slice(prefix.length));
    if (Number.isFinite(parsed)) seq = Math.max(seq, parsed);
  }
  let candidate: string;
  do {
    seq += 1;
    candidate = `${prefix}${String(seq).padStart(5, "0")}`;
  } while (existing.has(candidate));
  return candidate;
};

const emptyPR = (num: string, currency = "USD", rate = 1): PurchaseRequest => ({
  number: num,
  date: new Date().toISOString().slice(0, 10).replace(/-/g, "/"),
  invoiceNo: num,
  supplierCode: "",
  currency,
  rate,
  containerNo: "",
  containerSize: "40 قدم HQ",
  distributionType: "cbm",
  cbmPrice: 0,
  expensePercentage: 0,
  notes: "",
  rows: [],
  approved: false,
});

function PRPage() {
  const suppliers = useErpStore((s) => s.suppliers);
  const items = useErpStore((s) => s.items);
  const requests = useErpStore((s) => s.purchaseRequests);
  const hydrated = useErpStore((s) => s.hydrated);
  const settings = useErpStore((s) => s.settings);
  const currencies = settings.currencies ?? [];
  const rateOfCode = (code: string) => currencies.find((c) => c.code === code)?.rate ?? 1;
  const rateOf = rateOfCode;

  // كما في أمر الشراء: الدولار هو عملة الاحتساب الأساسية، و settings.defaultCurrency
  // تفضيل يخص شاشات أخرى ولا يتسرّب إلى مستند جديد هنا.
  const [pr, setPr] = useState<PurchaseRequest>(
    requests[0] ?? emptyPR("REQ-2026-00001", "USD", rateOfCode("USD")),
  );
  const [editing, setEditing] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  // مسودّة مستقلة عن مسودّة أمر الشراء، ومقصورة على المستخدم الحالي.
  const DRAFT_KEY = `erp:pr-draft-v1:${getCurrentScope() ?? "anon"}`;
  const [openDlg, setOpenDlg] = useState(false);
  const [supDlg, setSupDlg] = useState(false);
  const [searchDlg, setSearchDlg] = useState(false);
  const [itemsDlg, setItemsDlg] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // يمنع تحميل آخر طلب محفوظ فوق طلب يعمل عليه المستخدم أصلاً.
  const autoLoadedRef = useRef(false);
  const [markupPct, setMarkupPct] = useState<number>(30);
  const priceTiers = useErpStore((s) => s.settings.priceTiers ?? []);
  const currencyOptions = currencies.length
    ? currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))
    : [{ value: "USD", label: "USD" }];

  const masterCurrency = settings.masterCurrency || "USD";
  const setMasterCurrency = (code: string) => {
    erpStore.set({ settings: { ...settings, masterCurrency: code } });
  };

  const savedCount = pr.rows.filter(isRealRow).length;
  const metrics = useMemo(() => computePR(pr), [pr]);
  const supplier = suppliers.find((s) => s.code === pr.supplierCode);

  const { role } = useAuth();
  const mayWrite = canWrite(role);
  const mayDelete = canDelete(role);
  const mayApprove = canApprove(role);

  const disabled = !editing || pr.approved || !mayWrite;

  const patch = (p: Partial<PurchaseRequest>) => setPr({ ...pr, ...p });
  const patchRow = (id: number, p: Partial<PORow>) =>
    setPr({ ...pr, rows: pr.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const addRow = () =>
    setPr({
      ...pr,
      rows: [...pr.rows, { id: (pr.rows.at(-1)?.id ?? 0) + 1, model: "", name: "", unit: "حبة", pack: 1, qty: 0, price: 0, cbm: 0 }],
    });
  const removeRow = (id: number) => setPr({ ...pr, rows: pr.rows.filter((r) => r.id !== id) });

  // كل معالج يعيد فحص الصلاحية: أزرار الشريط معطّلة، لكن اختصارات لوحة المفاتيح
  // تستدعي هذه الدوال مباشرة.
  const denied = () => toast.error("ليس لديك صلاحية لهذا الإجراء");

  const onNew = async () => {
    if (!mayWrite) return denied();
    autoLoadedRef.current = true;
    setPr(emptyPR(await nextRequestNumber(), "USD", rateOfCode("USD")));
    setEditing(true);
    toast.success("تم إنشاء طلب شراء جديد");
  };
  const onSave = () => {
    if (!mayWrite) return denied();
    if (!pr.supplierCode) return toast.error("يجب اختيار المورد");
    const filled = pr.rows.filter(isRealRow);
    if (!filled.length) return toast.error("يجب إضافة صنف واحد على الأقل");
    void savePurchaseRequest({ ...pr, rows: filled });
    setEditing(false);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    toast.success("تم حفظ طلب الشراء");
  };
  const onEdit = () => {
    if (!mayWrite) return denied();
    setEditing(true);
    toast.info("وضع التعديل مفعّل");
  };
  const onDelete = async () => {
    if (!mayDelete) return denied();
    if (!confirm("حذف طلب الشراء؟")) return;
    autoLoadedRef.current = true;
    await deletePurchaseRequest(pr.number);
    setPr(emptyPR(await nextRequestNumber(), "USD", rateOfCode("USD")));
    setEditing(false);
    toast.success("تم الحذف");
  };
  const onApprove = () => {
    if (!mayApprove) return denied();
    const filled = pr.rows.filter(isRealRow);
    if (!pr.supplierCode || !filled.length) return toast.error("لا يمكن اعتماد طلب ناقص");
    const approved = { ...pr, rows: filled, approved: true };
    setPr(approved);
    void savePurchaseRequest(approved);
    setEditing(false);
    toast.success("تم اعتماد طلب الشراء");
  };
  const onPrint = () =>
    printPurchaseRequest({
      pr,
      supplier,
      companyName: settings.companyName || "طلب شراء",
      company: settings.company,
      markupPct,
      priceTiers,
      rateOfCode,
      masterCurrency,
    });

  const onImport = () => fileRef.current?.click();
  const onCopy = async () => {
    if (!mayWrite) return denied();
    autoLoadedRef.current = true;
    const num = await nextRequestNumber();
    setPr({ ...pr, number: num, invoiceNo: num, approved: false });
    setEditing(true);
    toast.success("تم نسخ الطلب - عدّل ثم احفظ");
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
      cbm: Number(r.cbm ?? r["CBM الكرتون"] ?? r["CBM"] ?? 0),
    }));
    setPr({ ...pr, rows });
    toast.success(`تم استيراد ${rows.length} صنف`);
    e.target.value = "";
  };
  const onExport = () => {
    const data = pr.rows.map((r, i) => ({ r, i })).filter(({ r }) => isRealRow(r)).map(({ r, i }, n) => ({
      "م": n + 1,
      "الموديل": r.model,
      "اسم الصنف": r.name,
      "الوحدة": r.unit,
      "العبوة": r.pack,
      "الكمية": r.qty,
      "سعر الشراء": r.price,
      "اجمالي الطلب": metrics.rowMetrics[i]?.lineInvoiceTotal ?? 0,
      "تكلفة الشراء$": metrics.rowMetrics[i]?.purchaseCost ?? 0,
      "CBM الكرتون": r.cbm,
      "إجمالي CBM": lineCBMOf(r),
      "تكلفة CBM $": metrics.rowMetrics[i]?.cbmCost ?? 0,
      "التكلفة المئوية $": metrics.rowMetrics[i]?.pctCost ?? 0,
      "متوسط التكلفة $": metrics.rowMetrics[i]?.avgCost ?? 0,
      "خرج للكرتون$": metrics.rowMetrics[i]?.allocatedExpPerCarton ?? 0,
      // السعر الفعلي: المكتوب يدوياً إن وُجد، وإلا المحسوب بنسبة الربح.
      [`سعر البيع (+${markupPct}%)`]:
        r.salePrice ?? (metrics.rowMetrics[i]?.selectedCost ?? 0) * (1 + markupPct / 100),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "طلب الشراء");
    XLSX.writeFile(wb, `${pr.number}.xlsx`);
    toast.success("تم التصدير إلى Excel");
  };

  const actions = [
    { icon: FilePlus2, label: "جديد", hint: "Ctrl+N", color: "text-emerald-600", onClick: onNew, disabled: !mayWrite },
    { icon: Copy, label: "نسخ", hint: "Ctrl+D", color: "text-purple-600", onClick: onCopy, disabled: !mayWrite },
    { icon: FolderOpen, label: "فتح", hint: "Ctrl+O", color: "text-amber-500", onClick: () => setOpenDlg(true) },
    { icon: Save, label: "حفظ", hint: "Ctrl+S", color: "text-blue-600", onClick: onSave, disabled: !editing || !mayWrite },
    { icon: Pencil, label: "تعديل", hint: "F2", color: "text-cyan-600", onClick: onEdit, disabled: pr.approved || !mayWrite },
    { icon: Trash2, label: "حذف", hint: "Del", color: "text-rose-600", onClick: onDelete, disabled: !mayDelete },
    { icon: Search, label: "بحث", hint: "F3", color: "text-indigo-500", onClick: () => { setItemsDlg(true); setSearchDlg(true); } },
    { icon: Printer, label: "طباعة", hint: "Ctrl+P", color: "text-slate-600", onClick: onPrint },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: onImport, disabled },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    { icon: CheckCircle2, label: "اعتماد", hint: "F9", color: "text-emerald-700", onClick: onApprove, disabled: pr.approved || !mayApprove },
    { icon: X, label: "إغلاق", hint: "Esc", color: "text-rose-600", onClick: () => history.back() },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "s") { e.preventDefault(); if (editing) onSave(); }
      else if (e.ctrlKey && k === "n") { e.preventDefault(); onNew(); }
      else if (e.ctrlKey && k === "o") { e.preventDefault(); setOpenDlg(true); }
      else if (e.ctrlKey && k === "p") { e.preventDefault(); onPrint(); }
      else if (e.key === "F2") { e.preventDefault(); if (!pr.approved) onEdit(); }
      else if (e.key === "F3") { e.preventDefault(); setItemsDlg(true); setSearchDlg(true); }
      else if (e.key === "F9") { e.preventDefault(); if (!pr.approved) onApprove(); }
      else if (e.ctrlKey && k === "d") { e.preventDefault(); onCopy(); }
      else if (e.key === "Escape") { setOpenDlg(false); setSupDlg(false); setSearchDlg(false); setItemsDlg(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr, editing]);

  // ── المسودّة: استرجاع عند الفتح، وحفظ تلقائي مع كل تعديل ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as PurchaseRequest;
        if (draft && !draft.approved) {
          autoLoadedRef.current = true;
          setPr(draft);
          setEditing(true);
          toast.info("تم استرجاع مسودة الطلب");
        }
      }
    } catch { /* ignore */ }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `requests` تكون [] في أول رسم لأن التحميل من التخزين غير متزامن — نحمّل آخر
  // طلب محفوظ مرّة واحدة بعد انتهاء التحميل، ما لم يكن المستخدم قد بدأ شيئاً.
  useEffect(() => {
    if (!hydrated || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    if (requests.length > 0) setPr(requests[0]);
  }, [hydrated, requests]);

  useEffect(() => {
    if (!draftRestored || !editing || pr.approved) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(pr)); } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(t);
  }, [pr, editing, draftRestored]);

  // جدول البنود يُعرَّف مرّة واحدة ويُعرض في مكانين — في الصفحة وداخل الشاشة
  // المنبثقة — بنفس التصميم ونفس مصدر البيانات (pr.rows).
  const itemsGrid = (
    <ErpTable
      headers={["م","الموديل","اسم الصنف","الوحدة","العبوة","الكمية","العملة","سعر الشراء","اجمالي الطلب","تكلفة الشراء$","CBM الكرتون","إجمالي CBM","تكلفة CBM $","التكلفة المئوية $","متوسط التكلفة $","خرج للكرتون$",`سعر البيع (+${markupPct}%)`,""]}
      widths={["2.2rem","6.4rem","250px","3.6rem","3.4rem","3.4rem","3.6rem","3.6rem","5rem","3.8rem","3.4rem","4rem","3.8rem","3.8rem","4.6rem","4.6rem","5rem","2rem"]}
    >
      {pr.rows.map((r, i) => {
        const m = metrics.rowMetrics[i];
        const cartons = cartonsOf(r);
        const rowCur = r.currency ?? pr.currency;
        // سعر البيع محسوب تلقائياً (التكلفة + نسبة الربح) ما لم يكتب المستخدم
        // سعراً لهذا السطر — عندها يُعرض المكتوب ويُميَّز بلون مختلف.
        const autoSale = (m?.selectedCost ?? 0) * (1 + markupPct / 100);
        const saleOverridden = r.salePrice !== undefined;
        const salePrice = saleOverridden ? r.salePrice! : autoSale;
        const dt = pr.distributionType;
        return (
          <tr key={r.id} className="hover:bg-slate-50">
            <td className="border border-slate-200 text-center text-slate-500 w-8">{i + 1}</td>
            <td className="border border-slate-200 p-0">
              <input value={r.model} disabled={disabled} onChange={(e) => {
                const v = e.target.value;
                const it = items.find((x) => x.code === v || x.barcode === v);
                // نأخذ عملة الصنف لكن بسعر صرف اليوم — لا السعر المثبَّت على
                // الصنف منذ آخر شراء.
                if (it) {
                  const rowCurrency = it.currency ?? r.currency ?? pr.currency;
                  patchRow(r.id, { model: it.code, name: it.name, cbm: it.cbmPerCarton, unit: it.units[0]?.name ?? r.unit, pack: it.units[0]?.pack ?? r.pack, price: it.units[0]?.lastPrice ?? r.price, currency: rowCurrency, rate: rateOf(rowCurrency) });
                }
                else patchRow(r.id, { model: v });
              }} className="w-full px-1 py-1 text-[13px] font-semibold tabular-nums text-slate-800 bg-white disabled:bg-slate-50 border-0 focus:outline-none text-center" />
            </td>
            <Cell value={r.name} onChange={(v) => patchRow(r.id, { name: v })} disabled={disabled} align="right" inputClass="text-[13px] font-semibold text-slate-800" />
            <Cell value={r.unit} onChange={(v) => patchRow(r.id, { unit: v })} disabled={disabled} />
            <Cell value={r.pack} onChange={(v) => patchRow(r.id, { pack: parseDecimal(v) })} disabled={disabled} align="right" type="number" />
            <Cell value={r.qty} onChange={(v) => patchRow(r.id, { qty: parseDecimal(v) })} disabled={disabled} align="right" type="number" />
            <td className="border border-slate-200 p-0">
              <select value={rowCur} disabled={disabled}
                onChange={(ev) => patchRow(r.id, { currency: ev.target.value, rate: rateOf(ev.target.value) })}
                className="w-full px-1 py-1 text-xs bg-white disabled:bg-slate-50 border-0 focus:outline-none">
                {currencyOptions.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
              </select>
            </td>
            <Cell value={r.price} onChange={(v) => patchRow(r.id, { price: parseDecimal(v) })} disabled={disabled} align="right" type="number" />
            {/* إجمالي الطلب = الكمية × العبوة × سعر الحبة، بعملة السطر */}
            <td className="border border-slate-200 text-right px-2 bg-slate-50 font-semibold text-slate-800">{fmt(m?.lineInvoiceTotal ?? 0, 1)}</td>
            <Cell value={fmt(m?.purchaseCost ?? 0, 1)} align="right" />
            <Cell value={r.cbm} onChange={(v) => patchRow(r.id, { cbm: parseDecimal(v) })} disabled={disabled} align="right" type="number" />
            <Cell value={fmt(cartons * r.cbm, 1)} align="right" />
            <td className={`border border-slate-200 text-right px-2 bg-slate-50 text-slate-700 ${dt === "cbm" ? "!bg-slate-200 font-bold" : ""}`}>{fmt(m?.cbmCost ?? 0, 1)}</td>
            <td className={`border border-slate-200 text-right px-2 bg-slate-50 text-slate-700 ${dt === "percentage" ? "!bg-slate-200 font-bold" : ""}`}>{fmt(m?.pctCost ?? 0, 1)}</td>
            <td className={`border border-slate-200 text-right px-2 bg-slate-50 text-slate-700 ${dt === "average" ? "!bg-slate-200 font-bold" : ""}`}>{fmt(m?.avgCost ?? 0, 1)}</td>
            <td className="border border-slate-200 text-right px-2 bg-slate-50 font-semibold text-slate-800">{fmt(m?.allocatedExpPerCarton ?? 0, 1)}</td>
            <SaleCell
              value={salePrice}
              overridden={saleOverridden}
              disabled={disabled}
              onChange={(v) => patchRow(r.id, { salePrice: v.trim() === "" ? undefined : parseDecimal(v) })}
            />
            <td className="border border-slate-200 text-center">
              <button disabled={disabled} onClick={() => removeRow(r.id)} className="text-rose-600 hover:bg-rose-50 p-1 rounded disabled:opacity-40" title="حذف"><Trash2 size={12} /></button>
            </td>
          </tr>
        );
      })}
    </ErpTable>
  );

  return (
    <ErpLayout title="طلب شراء" ribbon={<Ribbon actions={actions} />}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />

      {!mayWrite && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-medium bg-slate-100 border-slate-300 text-slate-700">
          <Info size={14} className="shrink-0" />
          صلاحيتك <b>مطالع</b> — يمكنك عرض وطباعة وتصدير طلبات الشراء فقط، دون إنشاء أو تعديل أو اعتماد.
        </div>
      )}
      {!editing && mayWrite && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded border text-xs font-medium ${
            pr.approved ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-amber-50 border-amber-300 text-amber-800"
          }`}
        >
          {pr.approved ? (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="shrink-0" />
              هذا طلب شراء <b>معتمد</b> ولا يمكن تعديله. لإنشاء طلب جديد اضغط «جديد»، أو «نسخ» لإنشاء نسخة قابلة للتعديل منه.
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Info size={14} className="shrink-0" />
              الشاشة حالياً في <b>وضع العرض فقط</b> ولا يمكن الكتابة في الحقول — اضغط «جديد» لإنشاء طلب شراء جديد، أو «تعديل» لتعديل هذا الطلب.
            </span>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={onNew} className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700">
              <FilePlus2 size={12} /> جديد
            </button>
            {pr.approved ? (
              <button onClick={onCopy} className="flex items-center gap-1 px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700">
                <Copy size={12} /> نسخ
              </button>
            ) : (
              <button onClick={onEdit} className="flex items-center gap-1 px-2 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-700">
                <Pencil size={12} /> تعديل
              </button>
            )}
          </div>
        </div>
      )}

      {/* ترتيب العمل: 1) المورد → 2) بيانات الطلب (وفيها سعر CBM والنسبة يدوياً) → 3) البنود → 4) التكلفة */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <Panel title={<StepTitle n={1} label="بيانات المورد" hint="اختر المورد أولاً" />}>
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
              <FieldRow label="كود المورد"><ErpInput value={pr.supplierCode} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="الدولة"><ErpInput value={supplier?.country ?? ""} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="المدينة"><ErpInput value={supplier?.city ?? ""} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="الهاتف"><ErpInput value={supplier?.phone ?? ""} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="البريد"><ErpInput value={supplier?.email ?? ""} onChange={() => {}} disabled /></FieldRow>
            </div>
          </div>
        </Panel>

        <Panel title={<StepTitle n={2} label="بيانات طلب الشراء" hint="سعر CBM ونسبة المصاريف يدويّان" />}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <FieldRow label="رقم الطلب"><ErpInput value={pr.number} onChange={(v) => patch({ number: v, invoiceNo: v })} disabled={pr.approved} highlight /></FieldRow>
            <FieldRow label="التاريخ"><ErpInput value={pr.date} onChange={(v) => patch({ date: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="العملة">
              <ErpSelect value={pr.currency} onChange={(v) => patch({ currency: v, rate: rateOf(v) })} disabled={disabled} options={currencyOptions} />
            </FieldRow>
            <FieldRow label={`سعر صرف ⁦1 USD = ? ${pr.currency}⁩`}>
              <ErpInput
                value={String(pr.rate)}
                onChange={(v) => {
                  const num = parseDecimal(v);
                  if (!(num > 0)) return;
                  // يُثبَّت على هذا المستند فقط — جدول العملات يُعدَّل من الإعدادات.
                  patch({ rate: num });
                }}
                disabled={disabled}
              />
            </FieldRow>
            <FieldRow label="رقم الحاوية"><ErpInput value={pr.containerNo} onChange={(v) => patch({ containerNo: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="حجم الحاوية"><ErpInput value={pr.containerSize} onChange={(v) => patch({ containerSize: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="توزيع المصاريف">
              <ErpSelect value={pr.distributionType} onChange={(v) => patch({ distributionType: v as any })} disabled={disabled} options={[
                { value: "cbm", label: "حسب تكلفة CBM" },
                { value: "percentage", label: "حسب التكلفة المئوية" },
                { value: "average", label: "حسب متوسط التكلفة" },
              ]} />
            </FieldRow>
            {/* الفرق الجوهري عن أمر الشراء: الحقلان التاليان مُدخلان يدوياً ولا
                يُشتقّان من أي مصروفات، فلا شاشة مصروفات في طلب الشراء. */}
            <FieldRow label="سعر CBM (USD)">
              <ErpInput
                value={pr.cbmPrice}
                onChange={(v) => patch({ cbmPrice: parseDecimal(v) })}
                disabled={disabled}
                type="number"
                highlight
              />
            </FieldRow>
            <FieldRow label="نسبة المصاريف %">
              <ErpInput
                value={pr.expensePercentage}
                onChange={(v) => patch({ expensePercentage: parseDecimal(v) })}
                disabled={disabled}
                type="number"
                highlight
              />
            </FieldRow>
            <FieldRow label="نسبة الربح %">
              <ErpInput value={markupPct} onChange={(v) => setMarkupPct(parseDecimal(v))} disabled={disabled} type="number" />
            </FieldRow>
            <div className="col-span-2">
              <FieldRow label="الملاحظات">
                <textarea value={pr.notes} onChange={(e) => patch({ notes: e.target.value })} disabled={disabled} className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:bg-slate-50 min-h-[50px]" />
              </FieldRow>
            </div>
          </div>
        </Panel>
      </div>

      {/* بنود الطلب — سطر واحد يفتح الشاشة المنبثقة، والجدول نفسه تحته مباشرة */}
      <button
        type="button"
        onClick={() => setItemsDlg(true)}
        className="w-full bg-white border border-slate-300 rounded px-3 py-2 flex items-center justify-between gap-2 hover:bg-emerald-50/60 hover:border-emerald-300 text-right transition-colors"
        title="فتح شاشة بنود الطلب (F3)"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
          <span className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded">
            <Package size={12} /> فتح شاشة البنود
          </span>
          <span className="text-[10px] text-slate-400 font-normal">F3</span>
        </div>
        <div className="flex items-center gap-2 font-semibold text-slate-700">
          <StepBadge n={3} />
          <Package size={14} />
          بنود الطلب ({savedCount})
        </div>
        <div className="text-xs text-slate-600 flex items-center gap-2">
          {pr.approved && <span className="text-emerald-600 font-semibold">✓ معتمد</span>}
          <span>إجمالي الطلب: <span className="font-bold">{fmt(metrics.totalInvoiceAmount, 1)}</span> {pr.currency}</span>
        </div>
      </button>

      <div className="bg-white border border-slate-300 rounded overflow-hidden -mt-1 w-max max-w-full">
        {itemsGrid}
      </div>

      {/* شاشة البنود المنبثقة */}
      <Dialog open={itemsDlg} onOpenChange={setItemsDlg}>
        <DialogContent dir="rtl" className="max-w-[97vw] p-0 gap-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
            <div className="flex items-center gap-1">
              <button onClick={() => { if (!editing) setEditing(true); addRow(); }} disabled={pr.approved || !mayWrite} className="flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40">
                <Plus size={12} /> إضافة صنف
              </button>
              <button onClick={() => setSearchDlg(true)} disabled={pr.approved || !mayWrite} className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-blue-50 disabled:opacity-40">
                <Search size={12} className="text-blue-600" /> بحث من الكتالوج
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Package className="text-emerald-600" size={20} />
              <h2 className="text-lg font-bold text-slate-800">بنود الطلب ({savedCount})</h2>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-3 bg-slate-50/60 border-b border-slate-200">
            <SummaryStat label="عدد الأصناف" value={fmtInt(metrics.totalItems)} unit="صنف" />
            <SummaryStat label="إجمالي الكمية" value={fmtInt(metrics.totalQty)} />
            <SummaryStat label="إجمالي الطلب" value={fmt(metrics.totalInvoiceAmount, 1)} unit={pr.currency} />
            <SummaryStat label="إجمالي CBM" value={fmt(metrics.totalCBM, 1)} unit="CBM" />
          </div>

          <div className="overflow-auto max-h-[60vh]">
            {itemsGrid}
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white">
            <button
              onClick={() => { onSave(); setItemsDlg(false); }}
              disabled={!mayWrite || pr.approved}
              className="flex items-center gap-1 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
            >
              <Check size={16} /> حفظ
            </button>
            <button onClick={() => setItemsDlg(false)} className="px-4 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50">
              إغلاق
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* تقدير التكلفة */}
      <div className="bg-white border border-slate-300 rounded">
        <div className="flex items-center justify-between px-3 py-1 font-semibold text-slate-700 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
          <div className="text-[11px] flex items-center gap-1">
            <Coins size={12} className="text-amber-600" />
            <span className="text-slate-600">العملة الرئيسية للإجمالي:</span>
            <select value={masterCurrency} onChange={(e) => setMasterCurrency(e.target.value)} className="px-2 py-0.5 text-[11px] border border-slate-300 rounded bg-white font-bold">
              {currencyOptions.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-1"><StepBadge n={4} /> تقدير التكلفة</div>
          <div className="text-[10px] text-slate-500">1 USD = {fmt(masterCurrency === "USD" ? 1 : (rateOfCode(masterCurrency) || 1), 4)} {masterCurrency}</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 p-2">
          <SummaryStat label="عدد الأصناف" value={fmtInt(metrics.totalItems)} unit="صنف" />
          <SummaryStat label="إجمالي الكمية" value={fmtInt(metrics.totalQty)} />
          <SummaryStat label="إجمالي الطلب" value={fmt(metrics.totalInvoiceAmount, 1)} unit={pr.currency} />
          <SummaryStat label="إجمالي الشراء" value={fmt(metrics.totalPurchase, 1)} unit="USD" />
          <SummaryStat label="إجمالي CBM" value={fmt(metrics.totalCBM, 1)} unit="CBM" />
          <SummaryStat label="سعر CBM (يدوي)" value={fmt(metrics.cbmPrice, 1)} unit="USD" />
          {/* مصاريف تقديرية = ما وزّعته الأسطر فعلاً على الأساس المختار، لا فواتير مسجّلة */}
          <SummaryStat label="مصاريف تقديرية" value={fmt(metrics.totalExpenses, 1)} unit="USD" />
          <SummaryStat label="إجمالي التكلفة" value={fmt(metrics.totalCost, 1)} unit="USD" highlight />
        </div>

        {metrics.cbmBasisUnusable && (
          <div className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 flex items-center gap-1.5">
            <Info size={13} className="shrink-0" />
            أدخلت سعر CBM لكن لا يوجد CBM على أي صنف، لذلك تعذّر التوزيع حسب CBM — وُزّعت المصاريف حسب «نسبة المصاريف %» بدلاً من ذلك. أدخل CBM الكرتون لكل صنف لاعتماد التوزيع الحجمي.
          </div>
        )}
        {noBasisEntered(pr) && (
          <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-700 flex items-center gap-1.5">
            <Info size={13} className="shrink-0" />
            {basisHint(pr)}
          </div>
        )}

        <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between">
          <div className="text-[11px] text-slate-600">
            الإجمالي التقديري (بالدولار) محوّل تلقائيًا إلى <b className="text-slate-800">{masterCurrency}</b>
          </div>
          <div className="text-lg font-black text-slate-800">
            {fmt(metrics.totalCost * (masterCurrency === "USD" ? 1 : (rateOfCode(masterCurrency) || 1)), 1)}
            <span className="text-xs text-slate-500 mr-2">{masterCurrency}</span>
          </div>
        </div>
      </div>

      {/* النوافذ */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>فتح طلب شراء</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-auto space-y-1">
            {requests.length === 0 && (
              <div className="text-xs text-slate-500 text-center py-4">لا توجد طلبات شراء محفوظة</div>
            )}
            {requests.map((r) => (
              <button key={r.number} onClick={() => { autoLoadedRef.current = true; setPr(r); setOpenDlg(false); setEditing(false); }} className="w-full text-right px-3 py-2 border border-slate-200 rounded hover:bg-slate-100 flex justify-between">
                <span className="text-xs text-slate-500">{r.date}</span>
                <span className="font-semibold">{r.number}</span>
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
              <button key={s.code} onClick={() => { patch({ supplierCode: s.code, currency: s.currency }); setSupDlg(false); }} className="w-full text-right px-3 py-2 border border-slate-200 rounded hover:bg-slate-100">
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
                setTimeout(() => setPr((cur) => {
                  const last = cur.rows[cur.rows.length - 1];
                  const rowCurrency = it.currency ?? cur.currency;
                  return { ...cur, rows: cur.rows.map((r) => r.id === last.id ? { ...r, model: it.code, name: it.name, cbm: it.cbmPerCarton, unit: it.units[0]?.name ?? "حبة", pack: it.units[0]?.pack ?? 1, price: it.units[0]?.lastPrice ?? 0, currency: rowCurrency, rate: rateOf(rowCurrency) } : r) };
                }), 0);
                setSearchDlg(false);
              }} className="w-full text-right p-2 border border-slate-200 rounded hover:bg-slate-100">
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

/**
 * الحقل الذي يقود التوزيع المختار تُرك صفراً — عندها لا تُوزَّع أي مصاريف
 * والتكلفة تساوي سعر الشراء وحده. نقولها صراحةً بدل أن يبدو الحساب «ناقصاً».
 */
function noBasisEntered(pr: PurchaseRequest): boolean {
  if (pr.distributionType === "cbm") return !(pr.cbmPrice > 0);
  if (pr.distributionType === "percentage") return !(pr.expensePercentage > 0);
  return !(pr.cbmPrice > 0) && !(pr.expensePercentage > 0);
}

function basisHint(pr: PurchaseRequest): string {
  if (pr.distributionType === "cbm") return "أدخل «سعر CBM» ليُحتسب نصيب كل صنف من المصاريف — التكلفة الآن = سعر الشراء فقط.";
  if (pr.distributionType === "percentage") return "أدخل «نسبة المصاريف %» ليُحتسب نصيب كل صنف من المصاريف — التكلفة الآن = سعر الشراء فقط.";
  return "أدخل «سعر CBM» و«نسبة المصاريف %» ليُحتسب متوسط التكلفة — التكلفة الآن = سعر الشراء فقط.";
}

function SummaryStat({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: boolean }) {
  return (
    <div className={`border rounded p-2 text-center shadow-sm ${highlight ? "bg-slate-100 border-slate-300" : "bg-white border-slate-200"}`}>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="font-bold text-slate-800 text-sm tabular-nums">{value} {unit && <span className="text-[10px] text-slate-500 font-normal">{unit}</span>}</div>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold shadow-sm">
      {n}
    </span>
  );
}

function StepTitle({ n, label, hint }: { n: number; label: string; hint?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StepBadge n={n} />
      <span>{label}</span>
      {hint && <span className="text-[10px] text-slate-500 font-normal">— {hint}</span>}
    </span>
  );
}
