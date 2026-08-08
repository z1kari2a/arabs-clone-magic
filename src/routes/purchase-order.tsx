import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer,
  FileSpreadsheet, Download, CheckCircle2, X, Plus, Wallet, Building2, Copy,
  Coins, Package, RefreshCcw, Info, Check, Tags,
} from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { Panel, FieldRow, LabelText, ErpInput, ErpSelect, ErpTable, Cell, SaleCell, fmt, fmtAuto, fmtInt, parseDecimal } from "@/components/erp/ErpUI";
import ExpensesDialog from "@/components/erp/ExpensesDialog";
import { printPurchaseOrder } from "@/lib/print-po";
import { erpStore, useErpStore, computePO, savePurchaseOrder, isRealRow, deletePO, cartonsOf, lineCBMOf, stashPO } from "@/lib/erp-store";
import { getCurrentScope, localDb } from "@/lib/local-db";
import { useAuth, canWrite, canDelete, canApprove } from "@/lib/auth";
import type { PurchaseOrder, PORow } from "@/lib/erp-types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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

/**
 * Next free invoice number, read from storage rather than the in-memory list.
 * The previous `INV-${year}-${random 5 digits}` could collide with an existing
 * invoice, and because orders are stored by `number`, a collision silently
 * OVERWROTE the older invoice. Sequential + an existence check rules that out.
 */
const nextInvoiceNumber = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const existing = new Set((await localDb.purchaseOrders.list()).map((o) => o.number));
  let seq = 0;
  for (const num of existing) {
    if (!num.startsWith(prefix)) continue;
    const n = Number(num.slice(prefix.length));
    if (Number.isFinite(n)) seq = Math.max(seq, n);
  }
  let candidate: string;
  do {
    seq += 1;
    candidate = `${prefix}${String(seq).padStart(5, "0")}`;
  } while (existing.has(candidate));
  return candidate;
};

const emptyPO = (num: string, currency = "USD", rate = 1): PurchaseOrder => ({
  number: num,
  date: new Date().toISOString().slice(0, 10).replace(/-/g, "/"),
  invoiceNo: num,
  supplierCode: "",
  currency,
  rate,
  containerNo: "",
  containerSize: "40 قدم HQ",
  distributionType: "cbm",
  notes: "",
  rows: [],
  expenses: [],
  approved: false,
});

function POPage() {
  const router = useRouter();
  const suppliers = useErpStore((s) => s.suppliers);
  const items = useErpStore((s) => s.items);
  const orders = useErpStore((s) => s.purchaseOrders);
  const hydrated = useErpStore((s) => s.hydrated);
  const settings = useErpStore((s) => s.settings);
  const currencies = settings.currencies ?? [];
  const rateOfCode = (code: string) => currencies.find((c) => c.code === code)?.rate ?? 1;

  // Purchase orders anchor to USD — the system's base accounting currency (see
  // "أسعار الصرف": rate = units of a currency per 1 USD). `settings.defaultCurrency`
  // is a separate, user-editable preference for OTHER screens (items, suppliers) and
  // must not leak into new invoices / totals here, or the grand total silently drifts
  // to whatever that unrelated setting happens to be.
  const [po, setPo] = useState<PurchaseOrder>(
    orders[0] ?? emptyPO("INV-2026-00001", "USD", rateOfCode("USD")),
  );
  const [editing, setEditing] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  // Scoped per signed-in user so a draft started by one account never bleeds
  // into another account's session on the same machine.
  const DRAFT_KEY = `erp:po-draft-v1:${getCurrentScope() ?? "anon"}`;
  const [openDlg, setOpenDlg] = useState(false);
  const [supDlg, setSupDlg] = useState(false);
  const [expDlg, setExpDlg] = useState(false);
  const [searchDlg, setSearchDlg] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Guards the one-time "load the last saved PO once the store hydrates" effect
  // below — any explicit user action (draft restore, new/copy/delete) disarms it
  // so it never clobbers a PO the user is already looking at.
  const autoLoadedRef = useRef(false);
  const [markupPct, setMarkupPct] = useState<number>(30);
  const priceTiers = useErpStore((s) => s.settings.priceTiers ?? []);
  const currencyOptions = currencies.length
    ? currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))
    : [{ value: "USD", label: "USD" }];
  const rateOf = rateOfCode;
  // Rate actually used to value an expense: the one pinned on the row, falling
  // back to the live table only for a line that has none yet. Mirrors computePO.

  // Master (grand-total) currency — used to display totals converted from invoice currency.
  // Defaults to USD (the system's base currency), not settings.defaultCurrency.
  const masterCurrency = settings.masterCurrency || "USD";
  const setMasterCurrency = (code: string) => {
    erpStore.set({ settings: { ...settings, masterCurrency: code } });
  };

  // Row-by-row editable table (classic ERP style).
  // isRealRow is the one shared definition of "a row that counts" — the totals,
  // this badge and the save filter must never drift apart again.
  const savedCount = po.rows.filter(isRealRow).length;

  // Note: exchange-rate editing lives only in Settings → Currencies panel.
  // Every screen reads settings.currencies read-only.

  const [itemsDlg, setItemsDlg] = useState(false);

  const metrics = useMemo(() => computePO(po), [po]);
  const supplier = suppliers.find((s) => s.code === po.supplierCode);

  // Role enforcement. canWrite/canDelete/canApprove already existed in lib/auth
  // but were never called anywhere, so a "مطالع" (viewer) could edit, delete and
  // approve every document exactly like an admin.
  const { role } = useAuth();
  const mayWrite = canWrite(role);
  const mayDelete = canDelete(role);
  const mayApprove = canApprove(role);

  const disabled = !editing || po.approved || !mayWrite;

  const patch = (p: Partial<PurchaseOrder>) => setPo({ ...po, ...p });
  const patchRow = (id: number, p: Partial<PORow>) =>
    setPo({ ...po, rows: po.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const addRow = () =>
    setPo({
      ...po,
      rows: [...po.rows, { id: (po.rows.at(-1)?.id ?? 0) + 1, model: "", name: "", unit: "حبة", pack: 1, qty: 0, price: 0, cbm: 0 }],
    });
  const removeRow = (id: number) => setPo({ ...po, rows: po.rows.filter((r) => r.id !== id) });

  // تحرير المصروفات كلّه داخل ExpensesDialog — لا نسخة ثانية هنا.

  // Each handler re-checks the role: the ribbon buttons are disabled below, but
  // the keyboard shortcuts (Ctrl+N/Ctrl+S/F2/F9/Del) call these directly.
  const denied = () => toast.error("ليس لديك صلاحية لهذا الإجراء");

  const onNew = async () => {
    if (!mayWrite) return denied();
    autoLoadedRef.current = true;
    setPo(emptyPO(await nextInvoiceNumber(), "USD", rateOfCode("USD")));
    setEditing(true);
    toast.success("تم إنشاء أمر شراء جديد");
  };
  const onSave = () => {
    if (!mayWrite) return denied();
    if (!po.supplierCode) return toast.error("يجب اختيار المورد");
    const filled = po.rows.filter(isRealRow);
    if (!filled.length) return toast.error("يجب إضافة صنف واحد على الأقل");
    savePurchaseOrder({ ...po, rows: filled });
    setEditing(false);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    toast.success("تم حفظ أمر الشراء");
  };
  const onEdit = () => {
    if (!mayWrite) return denied();
    setEditing(true);
    toast.info("وضع التعديل مفعّل");
  };
  const onDelete = async () => {
    if (!mayDelete) return denied();
    if (!confirm("حذف أمر الشراء؟")) return;
    autoLoadedRef.current = true;
    // Must go through deletePO — it removes the record from storage and writes
    // the audit entry. The old erpStore.set({ purchaseOrders: ... }) only
    // updated in-memory state, so the "deleted" order came straight back on the
    // next reload.
    await deletePO(po.number);
    setPo(emptyPO(await nextInvoiceNumber(), "USD", rateOfCode("USD")));
    setEditing(false);
    toast.success("تم الحذف");
  };
  const onApprove = () => {
    if (!mayApprove) return denied();
    const filled = po.rows.filter(isRealRow);
    if (!po.supplierCode || !filled.length) return toast.error("لا يمكن اعتماد أمر ناقص");
    const approved = { ...po, rows: filled, approved: true };
    setPo(approved);
    savePurchaseOrder(approved);
    setEditing(false);
    toast.success("تم اعتماد أمر الشراء");
  };
  // طباعة مستند الفاتورة كاملاً (بنود + مصروفات + مجاميع + تسعيرات) بدل
  // لقطة من الشاشة — انظر src/lib/print-po.ts.
  const onPrint = () =>
    printPurchaseOrder({
      po,
      supplier,
      companyName: settings.companyName || "أمر شراء",
      markupPct,
      priceTiers,
      rateOfCode,
      masterCurrency,
    });

  // «التسعيرات» — شاشة مستقلة. الفاتورة المعروضة قد تكون قيد التحرير ولم تُحفظ
  // بعد، فنمرّر نسخة منها (stashPO) لتقرأها تلك الشاشة إن لم تجد الرقم بين
  // الفواتير المحفوظة.
  const onTiers = () => {
    stashPO(po);
    router.navigate({ to: "/price-tiers", search: { po: po.number } });
  };

  const onImport = () => fileRef.current?.click();
  const onCopy = async () => {
    if (!mayWrite) return denied();
    autoLoadedRef.current = true;
    const num = await nextInvoiceNumber();
    setPo({ ...po, number: num, invoiceNo: num, approved: false });
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
      // Accept the header this screen itself exports ("CBM الكرتون") as well as a
      // bare "CBM" — importing our own export used to land a zero CBM on every row.
      cbm: Number(r.cbm ?? r["CBM الكرتون"] ?? r["CBM"] ?? 0),
    }));
    setPo({ ...po, rows });
    toast.success(`تم استيراد ${rows.length} صنف`);
    e.target.value = "";
  };
  const onExport = () => {
    // Keep the ORIGINAL index for the rowMetrics lookup while dropping the blank
    // filler rows, so the sheet neither exports empty lines nor shifts costs.
    const data = po.rows.map((r, i) => ({ r, i })).filter(({ r }) => isRealRow(r)).map(({ r, i }, n) => ({
      "م": n + 1,
      "الموديل": r.model,
      "اسم الصنف": r.name,
      "الوحدة": r.unit,
      "العبوة": r.pack,
      "الكمية": r.qty,
      "سعر الشراء": r.price,
      // نفس مسميات أعمدة ملف التاجر، حتى يخرج الملف مطابقاً لقالبه.
      "اجمالي امر الشراء": metrics.rowMetrics[i]?.lineInvoiceTotal ?? 0,
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
    XLSX.utils.book_append_sheet(wb, ws, "أمر الشراء");
    XLSX.writeFile(wb, `${po.number}.xlsx`);
    toast.success("تم التصدير إلى Excel");
  };

  const actions = [
    { icon: FilePlus2, label: "جديد", hint: "Ctrl+N", color: "text-emerald-600", onClick: onNew, disabled: !mayWrite },
    { icon: Copy, label: "نسخ", hint: "Ctrl+D", color: "text-purple-600", onClick: onCopy, disabled: !mayWrite },
    { icon: FolderOpen, label: "فتح", hint: "Ctrl+O", color: "text-amber-500", onClick: () => setOpenDlg(true) },
    { icon: Save, label: "حفظ", hint: "Ctrl+S", color: "text-blue-600", onClick: onSave, disabled: !editing || !mayWrite },
    { icon: Pencil, label: "تعديل", hint: "F2", color: "text-cyan-600", onClick: onEdit, disabled: po.approved || !mayWrite },
    { icon: Trash2, label: "حذف", hint: "Del", color: "text-rose-600", onClick: onDelete, disabled: !mayDelete },
    { icon: Search, label: "بحث", hint: "F3", color: "text-indigo-500", onClick: () => { setItemsDlg(true); setSearchDlg(true); } },
    { icon: Printer, label: "طباعة", hint: "Ctrl+P", color: "text-slate-600", onClick: onPrint },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: onImport, disabled },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    { icon: Wallet, label: "المصروفات", hint: "F4", color: "text-orange-600", onClick: () => setExpDlg(true) },
    { icon: Tags, label: "التسعيرات", hint: "F6", color: "text-fuchsia-600", onClick: onTiers },
    { icon: CheckCircle2, label: "اعتماد", hint: "F9", color: "text-emerald-700", onClick: onApprove, disabled: po.approved || !mayApprove },
    { icon: X, label: "إغلاق", hint: "Esc", color: "text-rose-600", onClick: () => history.back() },
  ];

  // Windows-like keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "s") { e.preventDefault(); if (editing) onSave(); }
      else if (e.ctrlKey && k === "n") { e.preventDefault(); onNew(); }
      else if (e.ctrlKey && k === "o") { e.preventDefault(); setOpenDlg(true); }
      else if (e.ctrlKey && k === "p") { e.preventDefault(); onPrint(); }
      else if (e.key === "F2") { e.preventDefault(); if (!po.approved) onEdit(); }
      else if (e.key === "F3") { e.preventDefault(); setItemsDlg(true); setSearchDlg(true); }
      else if (e.key === "F4") { e.preventDefault(); setExpDlg(true); }
      else if (e.key === "F6") { e.preventDefault(); onTiers(); }
      else if (e.key === "F9") { e.preventDefault(); if (!po.approved) onApprove(); }
      else if (e.ctrlKey && k === "d") { e.preventDefault(); onCopy(); }
      else if (e.key === "Escape") { setOpenDlg(false); setSupDlg(false); setExpDlg(false); setSearchDlg(false); setItemsDlg(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po, editing]);

  // ── Draft autosave: restore on mount, save on every edit ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as PurchaseOrder;
        if (draft && !draft.approved) {
          autoLoadedRef.current = true;
          setPo(draft);
          setEditing(true);
          toast.info("تم استرجاع مسودة الفاتورة");
        }
      }
    } catch { /* ignore */ }
    setDraftRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `orders` is still [] on the very first render — hydrateStore() reads
  // purchase orders from local storage asynchronously — so the `po` state above
  // captures a blank placeholder invoice before the real saved data arrives.
  // Once hydration finishes, load the most recently saved order exactly once,
  // unless something else (a restored draft, "جديد"/"نسخ"/"حذف"/"فتح") already
  // took over `po` first. Without this, reloading the page after saving a
  // purchase order silently shows a blank new invoice instead of what was saved.
  useEffect(() => {
    if (!hydrated || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    if (orders.length > 0) setPo(orders[0]);
  }, [hydrated, orders]);

  useEffect(() => {
    if (!draftRestored || !editing || po.approved) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(po)); } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(t);
  }, [po, editing, draftRestored]);

  // جدول البنود يُعرَّف مرّة واحدة ويُعرض في مكانين — أسفل سطر البنود في
  // الصفحة، وداخل الشاشة المنبثقة — بنفس التصميم بالضبط. مصدر البيانات واحد
  // (po.rows) فأي تعديل في أحدهما يظهر فوراً في الآخر.
  // الأسماء والأحجام مطابقة لملف التاجر: أعمدة ضيّقة ثابتة والعنوان يلتف في
  // سطرين بدل ما يمدّد العمود.
  const itemsGrid = (
        <ErpTable
          headers={["م","الموديل","اسم الصنف","الوحدة","العبوة","الكمية","العملة","سعر الشراء","اجمالي امر الشراء","تكلفة الشراء$","CBM الكرتون","إجمالي CBM","تكلفة CBM $","التكلفة المئوية $","متوسط التكلفة $","خرج للكرتون$",`سعر البيع (+${markupPct}%)`,""]}
          widths={["2.2rem","4.5rem","7.5rem","3.6rem","3.4rem","3.4rem","3.6rem","4rem","5rem","4.6rem","4rem","4rem","4.4rem","4.6rem","4.6rem","4.6rem","5rem","2rem"]}
        >
          {po.rows.map((r, i) => {
            const m = metrics.rowMetrics[i];
            const cartons = cartonsOf(r);
            const rowCur = r.currency ?? po.currency;
            // سعر البيع محسوب تلقائياً (التكلفة المعتمدة + نسبة الربح) ما لم
            // يكتب المستخدم سعراً لهذا السطر — عندها يُعرض المكتوب ويُميَّز بلون.
            const autoSale = (m?.selectedCost ?? 0) * (1 + markupPct / 100);
            const saleOverridden = r.salePrice !== undefined;
            const salePrice = saleOverridden ? r.salePrice! : autoSale;
            const dt = po.distributionType;
            return (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="border border-slate-200 text-center text-slate-500 w-8">{i + 1}</td>
                <td className="border border-slate-200 p-0">
                  <input value={r.model} disabled={disabled} onChange={(e) => {
                    const v = e.target.value;
                    const it = items.find((x) => x.code === v || x.barcode === v);
                    // Take the item's currency, but price it at TODAY's rate.
                    // `it.rate` is the rate pinned at the item's last purchase —
                    // carrying it into a new invoice valued today's goods at a
                    // months-old exchange rate.
                    if (it) {
                      const rowCurrency = it.currency ?? r.currency ?? po.currency;
                      patchRow(r.id, { model: it.code, name: it.name, cbm: it.cbmPerCarton, unit: it.units[0]?.name ?? r.unit, pack: it.units[0]?.pack ?? r.pack, price: it.units[0]?.lastPrice ?? r.price, currency: rowCurrency, rate: rateOf(rowCurrency) });
                    }
                    else patchRow(r.id, { model: v });
                  }} className="w-full px-1 py-1 text-xs bg-white disabled:bg-slate-50 border-0 focus:outline-none text-center" />
                </td>
                <Cell value={r.name} onChange={(v) => patchRow(r.id, { name: v })} disabled={disabled} align="right" />
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
                {/* إجمالي أمر الشراء = الكمية × العبوة × سعر الحبة، بعملة السطر */}
                <td className="border border-slate-200 text-right px-2 bg-slate-50 font-semibold text-slate-800">{fmtAuto(m?.lineInvoiceTotal ?? 0, 4)}</td>
                <Cell value={fmt(m?.purchaseCost ?? 0, 1)} align="right" />
                <Cell value={r.cbm} onChange={(v) => patchRow(r.id, { cbm: parseDecimal(v) })} disabled={disabled} align="right" type="number" />
                <Cell value={fmtAuto(cartons * r.cbm, 4)} align="right" />
                <td className={`border border-slate-200 text-right px-2 bg-slate-50 text-slate-700 ${dt === "cbm" ? "!bg-slate-200 font-bold" : ""}`}>{fmt(m?.cbmCost ?? 0, 1)}</td>
                <td className={`border border-slate-200 text-right px-2 bg-slate-50 text-slate-700 ${dt === "percentage" ? "!bg-slate-200 font-bold" : ""}`}>{fmt(m?.pctCost ?? 0, 1)}</td>
                <td className={`border border-slate-200 text-right px-2 bg-slate-50 text-slate-700 ${dt === "average" ? "!bg-slate-200 font-bold" : ""}`}>{fmt(m?.avgCost ?? 0, 1)}</td>
                <td className="border border-slate-200 text-right px-2 bg-slate-50 font-semibold text-slate-800">{fmt(m?.allocatedExpPerCarton ?? 0, 5)}</td>
                <SaleCell
                  value={salePrice}
                  overridden={saleOverridden}
                  disabled={disabled}
                  decimals={4}
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
    <ErpLayout title="أمر شراء" ribbon={<Ribbon actions={actions} />}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />

      {/* Read-only mode isn't obvious from grayed-out fields alone — spell it out
          and offer the exact action needed, so the screen never looks "stuck". */}
      {!mayWrite && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-medium bg-slate-100 border-slate-300 text-slate-700">
          <Info size={14} className="shrink-0" />
          صلاحيتك <b>مطالع</b> — يمكنك عرض وطباعة وتصدير أوامر الشراء فقط، دون إنشاء أو تعديل أو اعتماد.
        </div>
      )}
      {!editing && mayWrite && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded border text-xs font-medium ${
            po.approved ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-amber-50 border-amber-300 text-amber-800"
          }`}
        >
          {po.approved ? (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="shrink-0" />
              هذا أمر شراء <b>معتمد</b> ولا يمكن تعديله. لإنشاء أمر جديد اضغط «جديد»، أو «نسخ» لإنشاء نسخة قابلة للتعديل منه.
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Info size={14} className="shrink-0" />
              الشاشة حالياً في <b>وضع العرض فقط</b> ولا يمكن الكتابة في الحقول — اضغط «جديد» لإنشاء أمر شراء جديد، أو «تعديل» لتعديل هذا الأمر.
            </span>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={onNew} className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700">
              <FilePlus2 size={12} /> جديد
            </button>
            {po.approved ? (
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

      {/* Workflow order: 1) Supplier → 2) Order data → 3) Items → 4) Expenses → 5) Cost → 6) Tiers */}
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
              <FieldRow label="كود المورد"><ErpInput value={po.supplierCode} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="الدولة"><ErpInput value={supplier?.country ?? ""} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="المدينة"><ErpInput value={supplier?.city ?? ""} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="الهاتف"><ErpInput value={supplier?.phone ?? ""} onChange={() => {}} disabled /></FieldRow>
              <FieldRow label="البريد"><ErpInput value={supplier?.email ?? ""} onChange={() => {}} disabled /></FieldRow>
            </div>
          </div>
        </Panel>

        <Panel title={<StepTitle n={2} label="بيانات أمر الشراء" hint="رقم الفاتورة، العملة، طريقة التوزيع" />}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <FieldRow label="رقم الفاتورة"><ErpInput value={po.number} onChange={(v) => patch({ number: v, invoiceNo: v })} disabled={po.approved} highlight /></FieldRow>
            <FieldRow label="التاريخ"><ErpInput value={po.date} onChange={(v) => patch({ date: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="العملة">
              <ErpSelect value={po.currency} onChange={(v) => patch({ currency: v, rate: rateOf(v) })} disabled={disabled} options={currencyOptions} />
            </FieldRow>
            <FieldRow label={`سعر صرف ⁦1 USD = ? ${po.currency}⁩`}>
              <ErpInput
                value={String(po.rate)}
                onChange={(v) => {
                  const n = parseDecimal(v);
                  if (!(n > 0)) return;
                  // Pin this rate on THIS document only — do not touch the
                  // global currency table (that's Settings → أسعار الصرف's job).
                  patch({ rate: n });
                }}
                disabled={disabled}
              />
            </FieldRow>
            <FieldRow label="رقم الحاوية"><ErpInput value={po.containerNo} onChange={(v) => patch({ containerNo: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="حجم الحاوية"><ErpInput value={po.containerSize} onChange={(v) => patch({ containerSize: v })} disabled={disabled} /></FieldRow>
            <FieldRow label="توزيع المصروفات">
              <ErpSelect value={po.distributionType} onChange={(v) => patch({ distributionType: v as any })} disabled={disabled} options={[
                { value: "cbm", label: "حسب تكلفة CBM" },
                { value: "percentage", label: "حسب التكلفة المئوية" },
                { value: "average", label: "حسب متوسط التكلفة" },
              ]} />
            </FieldRow>
            <FieldRow label="سعر CBM">
              <ErpInput
                value={`${fmt(metrics.cbmPrice, 2)} USD`}
                onChange={() => {}}
                disabled
                highlight
              />
            </FieldRow>
            <FieldRow label="نسبة المصاريف %">
              <div className="flex gap-1">
                <ErpInput
                  // Pass the NUMBER, rounded for readability — `fmt` inserts
                  // thousand separators ("1,200.00"), and a comma is a decimal
                  // separator to parseDecimal, so a percentage over 999 was read
                  // back as 0 the moment this field re-rendered.
                  value={Math.round((po.expensePercentage ?? metrics.suggestedPct) * 100) / 100}
                  onChange={(v) => patch({ expensePercentage: parseDecimal(v) })}
                  disabled={disabled}
                  type="number"
                  highlight
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => patch({ expensePercentage: undefined })}
                  title="إعادة الاحتساب تلقائياً = (إجمالي المصروفات ÷ إجمالي الشراء) × 100"
                  className="px-2 border border-slate-300 bg-slate-50 rounded disabled:opacity-40 shrink-0"
                >
                  <RefreshCcw size={12} />
                </button>
              </div>
            </FieldRow>
            <FieldRow label="نسبة الربح %">
              <ErpInput value={markupPct} onChange={(v) => setMarkupPct(parseDecimal(v))} disabled={disabled} type="number" />
            </FieldRow>
            <div className="col-span-2">
              <FieldRow label="الملاحظات">
                <textarea value={po.notes} onChange={(e) => patch({ notes: e.target.value })} disabled={disabled} className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:bg-slate-50 min-h-[50px]" />
              </FieldRow>
            </div>
          </div>
        </Panel>

      </div>

      {/* بنود الفاتورة — سطر واحد يفتح الشاشة المنبثقة، والجدول كله يعيش هناك
          (نفس نمط المصروفات): يُضاف ويُحرّر ويُحفظ داخل النافذة. */}
      <button
        type="button"
        onClick={() => setItemsDlg(true)}
        className="w-full bg-white border border-slate-300 rounded px-3 py-2 flex items-center justify-between gap-2 hover:bg-emerald-50/60 hover:border-emerald-300 text-right transition-colors"
        title="فتح شاشة بنود الفاتورة (F3)"
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
          بنود الفاتورة ({savedCount})
        </div>
        <div className="text-xs text-slate-600 flex items-center gap-2">
          {po.approved && <span className="text-emerald-600 font-semibold">✓ معتمد</span>}
          <span>إجمالي أمر الشراء: <span className="font-bold">{fmtAuto(metrics.totalInvoiceAmount, 4)}</span> {po.currency}</span>
        </div>
      </button>

      {/* نفس الجدول تحت سطره مباشرة — بنفس التصميم بالضبط (متغيّر واحد يُعرض هنا
          وداخل النافذة)، وبنفس مصدر البيانات فالتعديل في أي منهما يظهر في الآخر. */}
      <div className="bg-white border border-slate-300 rounded overflow-hidden -mt-1">
        {itemsGrid}
      </div>

      {/* شاشة البنود المنبثقة */}
      <Dialog open={itemsDlg} onOpenChange={setItemsDlg}>
        <DialogContent dir="rtl" className="max-w-[97vw] p-0 gap-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
            <div className="flex items-center gap-1">
              <button onClick={() => { if (!editing) setEditing(true); addRow(); }} disabled={po.approved || !mayWrite} className="flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40">
                <Plus size={12} /> إضافة صنف
              </button>
              <button onClick={() => setSearchDlg(true)} disabled={po.approved || !mayWrite} className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-blue-50 disabled:opacity-40">
                <Search size={12} className="text-blue-600" /> بحث من الكتالوج
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Package className="text-emerald-600" size={20} />
              <h2 className="text-lg font-bold text-slate-800">بنود الفاتورة ({savedCount})</h2>
            </div>
          </div>

          {/* شريط الإجماليات داخل النافذة */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-3 bg-slate-50/60 border-b border-slate-200">
            <SummaryStat label="عدد الأصناف" value={fmtInt(metrics.totalItems)} unit="صنف" />
            <SummaryStat label="إجمالي الكمية" value={fmtInt(metrics.totalQty)} />
            <SummaryStat label="إجمالي أمر الشراء" value={fmtAuto(metrics.totalInvoiceAmount, 4)} unit={po.currency} />
            <SummaryStat label="إجمالي CBM" value={fmtAuto(metrics.totalCBM, 4)} unit="CBM" />
          </div>

        <div className="overflow-auto max-h-[60vh]">
        {itemsGrid}
        </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white">
            <button
              onClick={() => { onSave(); setItemsDlg(false); }}
              disabled={!mayWrite || po.approved}
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

      {/* Expenses — سطر واحد فقط: الجدول كله يعيش داخل الشاشة المنبثقة،
          يُضاف ويُحرّر ويُحفظ هناك. كان مكرّراً هنا وفي النافذة معاً، فكان
          التعديل في مكان يبدو وكأنه ضاع كي تفتح المكان الآخر. */}
      <button
        type="button"
        onClick={() => setExpDlg(true)}
        disabled={disabled}
        className="w-full bg-white border border-slate-300 rounded px-3 py-2 flex items-center justify-between gap-2 hover:bg-blue-50/60 hover:border-blue-300 disabled:opacity-50 disabled:hover:bg-white text-right transition-colors"
        title="فتح شاشة المصروفات (F4)"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
          <span className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded">
            <Wallet size={12} /> فتح شاشة المصروفات
          </span>
          <span className="text-[10px] text-slate-400 font-normal">F4</span>
        </div>
        <div className="flex items-center gap-2 font-semibold text-slate-700">
          <StepBadge n={4} />
          <Wallet size={14} />
          المصروفات ({po.expenses.length})
        </div>
        <div className="text-xs text-slate-600">
          الإجمالي: <span className="font-bold">{fmt(metrics.totalExpenses)}</span> USD
        </div>
      </button>

      {/* Summary */}
      <div className="bg-white border border-slate-300 rounded">
        <div className="flex items-center justify-between px-3 py-1 font-semibold text-slate-700 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
          <div className="text-[11px] flex items-center gap-1">
            <Coins size={12} className="text-amber-600" />
            <span className="text-slate-600">العملة الرئيسية للإجمالي:</span>
            <select value={masterCurrency} onChange={(e) => setMasterCurrency(e.target.value)} className="px-2 py-0.5 text-[11px] border border-slate-300 rounded bg-white font-bold">
              {currencyOptions.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-1"><StepBadge n={5} /> احتساب التكلفة النهائية</div>
          <div className="text-[10px] text-slate-500">1 USD = {fmt(masterCurrency === "USD" ? 1 : (rateOfCode(masterCurrency) || 1), 4)} {masterCurrency}</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 p-2">
          <SummaryStat label="عدد الأصناف" value={fmtInt(metrics.totalItems)} unit="صنف" />
          <SummaryStat label="إجمالي الكمية" value={fmtInt(metrics.totalQty)} />
          {/* مجموع عمود "إجمالي أمر الشراء" — قيمة الفاتورة بعملتها كما يصدرها المورد */}
          <SummaryStat label="إجمالي أمر الشراء" value={fmtAuto(metrics.totalInvoiceAmount, 4)} unit={po.currency} />
          <SummaryStat label="إجمالي الشراء" value={fmt(metrics.totalPurchase)} unit="USD" />
          <SummaryStat label="إجمالي CBM" value={fmtAuto(metrics.totalCBM, 4)} unit="CBM" />
          <SummaryStat label="إجمالي المصروفات" value={fmt(metrics.totalExpenses)} unit="USD" />
          <SummaryStat label="سعر CBM" value={fmt(metrics.cbmPrice)} unit="USD" />
          <SummaryStat label="إجمالي التكلفة" value={fmt(metrics.totalCost)} unit="USD" highlight />
        </div>
        {/* Two conditions that used to fail silently and leave the item costs
            contradicting the header total — say them out loud instead. */}
        {metrics.cbmBasisUnusable && (
          <div className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 flex items-center gap-1.5">
            <Info size={13} className="shrink-0" />
            لا يوجد CBM مُدخل على أي صنف، لذلك تعذّر التوزيع حسب CBM — تم توزيع المصروفات نسبةً إلى قيمة الشراء بدلاً من ذلك. أدخل CBM الكرتون لكل صنف لاعتماد التوزيع الحجمي.
          </div>
        )}
        {!metrics.allocationBalanced && (
          <div className="border-t border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-800 flex items-center gap-1.5">
            <Info size={13} className="shrink-0" />
            «نسبة المصاريف %» المُدخلة يدوياً توزّع <b>{fmt(metrics.allocatedExpenses)}</b> USD بينما إجمالي المصروفات الفعلي <b>{fmt(metrics.totalExpenses)}</b> USD
            (فرق <b>{fmt(metrics.allocationDiff)}</b>). اضغط زر إعادة الاحتساب بجوار الحقل لمطابقتهما.
          </div>
        )}
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between">
          <div className="text-[11px] text-slate-600">
            الإجمالي النهائي (بالدولار) محوّل تلقائيًا إلى <b className="text-slate-800">{masterCurrency}</b>
          </div>
          <div className="text-lg font-black text-slate-800">
            {fmt(metrics.totalCost * (masterCurrency === "USD" ? 1 : (rateOfCode(masterCurrency) || 1)))}
            <span className="text-xs text-slate-500 mr-2">{masterCurrency}</span>
          </div>
        </div>
      </div>

      {/* التسعيرات حسب الوجهات لها شاشة مستقلة — المدخل الوحيد إليها زر
          «التسعيرات» (F6) في شريط الأوامر أعلاه، بلا سطر أو جدول هنا. */}

      {/* Dialogs */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>فتح أمر شراء</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-auto space-y-1">
            {orders.map((o) => (
              <button key={o.number} onClick={() => { autoLoadedRef.current = true; setPo(o); setOpenDlg(false); setEditing(false); }} className="w-full text-right px-3 py-2 border border-slate-200 rounded hover:bg-slate-100 flex justify-between">
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
                setTimeout(() => setPo((cur) => {
                  const last = cur.rows[cur.rows.length - 1];
                  // Today's rate for the item's currency — never the stale one
                  // pinned on the catalog entry at its last purchase.
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

      <ExpensesDialog
        open={expDlg}
        onOpenChange={setExpDlg}
        expenses={po.expenses}
        invoiceCurrency={po.currency}
        currencies={currencies}
        expenseTypes={settings.expenseTypes ?? []}
        disabled={disabled}
        onSave={(rows) => {
          const next = { ...po, expenses: rows };
          setPo(next);
          // "حفظ" داخل النافذة يحفظ فعلاً: إذا كان أمر الشراء محفوظاً من قبل،
          // تُخزَّن المصروفات عليه فوراً بدل ما تبقى في الذاكرة وتضيع لو غادر
          // الشاشة. أمر جديد لم يُحفظ بعد يبقى مسودّة حتى يُحفظ كاملاً.
          const alreadySaved = orders.some((o) => o.number === po.number);
          if (alreadySaved && mayWrite) {
            void savePurchaseOrder({ ...next, rows: next.rows.filter(isRealRow) });
          }
        }}
        onSaveExpenseTypes={(types) => erpStore.set({ settings: { ...settings, expenseTypes: types } })}
      />
    </ErpLayout>
  );
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

function _OldSummaryStat({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: boolean }) {
  return (
    <div className={`border rounded p-2 text-center shadow-sm ${highlight ? "bg-slate-100 border-slate-300" : "bg-white border-slate-200"}`}>
      <div className="text-[11px] text-slate-600">{label}</div>
      <div className="text-lg font-bold text-slate-800 leading-tight">{value}</div>
      {unit && <div className="text-[10px] text-slate-500">{unit}</div>}
    </div>
  );
}