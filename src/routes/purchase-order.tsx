import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Plus,
  Wallet,
  Building2,
  Copy,
  Coins,
  Package,
  RefreshCcw,
  Info,
  Check,
  Tags,
  Undo2,
} from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { useCloseGuard } from "@/components/erp/CloseGuard";
import {
  Panel,
  FieldRow,
  LabelText,
  ErpInput,
  ErpSelect,
  ErpTable,
  Cell,
  SaleCell,
  fmt,
  fmtAuto,
  fmtInt,
  parseDecimal,
} from "@/components/erp/ErpUI";
import ExpensesDialog from "@/components/erp/ExpensesDialog";
import RowMenu from "@/components/erp/RowMenu";
import { LookupInput, ItemsLookupDialog, UnitsLookupDialog } from "@/components/erp/ItemLookup";
import { itemMatches } from "@/lib/item-search";
import { printPurchaseOrder } from "@/lib/print-po";
import {
  erpStore,
  useErpStore,
  computePO,
  savePurchaseOrder,
  ApprovedDocumentError,
  isRealRow,
  deletePO,
  cartonsOf,
  lineCBMOf,
  stashPO,
  repinRates,
} from "@/lib/erp-store";
import { cell, numCell } from "@/lib/sheet";
import { getCurrentScope, localDb, writeWebStorage } from "@/lib/local-db";
import { useAuth, canWrite, canDelete, canApprove } from "@/lib/auth";
import type { Item, PurchaseOrder, PORow } from "@/lib/erp-types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  // قائمة الأصناف المفتوحة من خانة في الجدول: أي سطر فُتحت منه، وبأي ترتيب
  // (حسب الرقم إن فُتحت من خانة الموديل، وحسب الاسم إن فُتحت من خانة الاسم)،
  // وبأي نصّ مكتوب مسبقاً. `null` = لا قائمة مفتوحة.
  const [lookup, setLookup] = useState<{
    rowId: number;
    sortBy: "code" | "name";
    term: string;
  } | null>(null);
  // قائمة الوحدات المسجّلة (F9 من خانة «الوحدة»).
  const [unitDlg, setUnitDlg] = useState<{ rowId: number; model: string } | null>(null);
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
  // سعر صرف الرأس يخصّ عملة الفاتورة، فيسري على كل سطر ومصروف بنفس العملة.
  // كان يُكتب على الرأس وحده، بينما الحساب يفضّل السعر المثبَّت على السطر
  // (erp-store.ts: costingBase) — فالأسطر القادمة من دليل الأصناف تبقى على سعرها
  // القديم ولا يتحرك إلا ما لا سعر له، فيبدو أن التعديل "لا يتحدث".
  // الأسطر بعملة أخرى لا تُمسّ — لها سعرها، و«تحديث الأسعار» هو ما يطالها.
  // تغيير عملة الفاتورة: الأسطر التي لا تحمل عملة صريحة تتبع الرأس، فيتبع
  // سعرُها سعرَه — وإلا بقي عليها سعر العملة السابقة الذي كتبه setDocRate.
  // السطر ذو العملة الصريحة يبقى كما هو (له عملته وسعره).
  const setDocCurrency = (code: string) => {
    const n = rateOf(code);
    setPo((cur) => ({
      ...cur,
      currency: code,
      rate: n,
      rows: cur.rows.map((r) => (r.currency ? r : { ...r, rate: n })),
    }));
  };
  const setDocRate = (n: number) =>
    setPo((cur) => ({
      ...cur,
      rate: n,
      rows: cur.rows.map((r) =>
        (r.currency ?? cur.currency) === cur.currency ? { ...r, rate: n } : r,
      ),
      expenses: cur.expenses.map((e) => (e.currency === cur.currency ? { ...e, rate: n } : e)),
    }));
  const patchRow = (id: number, p: Partial<PORow>) =>
    setPo({ ...po, rows: po.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const addRow = () =>
    setPo({
      ...po,
      rows: [
        ...po.rows,
        {
          id: (po.rows.at(-1)?.id ?? 0) + 1,
          model: "",
          name: "",
          unit: "حبة",
          pack: 1,
          qty: 0,
          price: 0,
          cbm: 0,
        },
      ],
    });
  const removeRow = (id: number) => setPo({ ...po, rows: po.rows.filter((r) => r.id !== id) });
  /**
   * نسخ صنف من الدليل إلى سطر بعينه. المسار الوحيد الذي يملأ بيانات صنف في
   * السطر: لا شيء يُملأ أثناء الكتابة حرفاً حرفاً بعد الآن — كان أي نصّ يوافق
   * موديلاً أو باركوداً عابراً يقفز إلى السطر فيَدخل صنفٌ غير الذي يقصده
   * المستخدم. الآن يدخل الصنف بالاختيار من القائمة أو بمطابقة تامّة عند Enter.
   */
  const applyItem = (rowId: number, it: Item) =>
    setPo((cur) => ({
      ...cur,
      rows: cur.rows.map((r) => {
        if (r.id !== rowId) return r;
        // عملة الصنف بسعر صرف اليوم — لا السعر المثبَّت عليه منذ آخر شراء.
        const rowCurrency = it.currency ?? r.currency ?? cur.currency;
        return {
          ...r,
          model: it.code,
          name: it.name,
          cbm: it.cbmPerCarton,
          unit: it.units[0]?.name ?? r.unit,
          pack: it.units[0]?.pack ?? r.pack,
          price: it.units[0]?.lastPrice ?? r.price,
          currency: rowCurrency,
          rate: rateOf(rowCurrency),
        };
      }),
    }));
  /**
   * إضافة سطر جديد مملوء بصنف من الدليل — تحديثٌ واحد للحالة. كان المسار
   * السابق `addRow()` ثم `setTimeout` يعدّل «آخر سطر»، فأي إضافة أخرى تتخلّل
   * المهلة تجعل البيانات تهبط على السطر الخطأ.
   */
  const addRowFromItem = (it: Item) =>
    setPo((cur) => {
      const rowCurrency = it.currency ?? cur.currency;
      return {
        ...cur,
        rows: [
          ...cur.rows,
          {
            id: (cur.rows.at(-1)?.id ?? 0) + 1,
            model: it.code,
            name: it.name,
            unit: it.units[0]?.name ?? "حبة",
            pack: it.units[0]?.pack ?? 1,
            qty: 0,
            price: it.units[0]?.lastPrice ?? 0,
            cbm: it.cbmPerCarton,
            currency: rowCurrency,
            rate: rateOf(rowCurrency),
          },
        ],
      };
    });
  /**
   * Enter في خانة الموديل/الاسم يفتح قائمة بكل ما يحتوي المكتوب — رقماً كان أو
   * اسماً. لا يُملأ صنفٌ إلا باختيار صريح من القائمة، حتى لا «يدخل صنف آخر».
   * المطابقة التامّة تُبرَز مختارةً سلفاً فيكفيها Enter ثانية.
   * Enter على خانة فارغة يبقى تنقّلاً بين الأسطر كما كان.
   */
  const lookupFromCell = (rowId: number, text: string, sortBy: "code" | "name") => {
    const term = text.trim();
    if (!term) return false;
    setLookup({ rowId, sortBy, term });
    return true;
  };

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
  // يُعيد true عند نجاح الحفظ و false عند رفضه — حارس الإغلاق (useCloseGuard)
  // يعتمد على هذه القيمة: حفظ مرفوض يعني أن الشاشة تبقى مفتوحة بدل أن تُغلق
  // وتضيع البيانات.
  //
  // غير متزامنة عمداً: كانت تستدعي `savePurchaseOrder` بلا انتظار ثم تُظهر «تم
  // الحفظ» وتُعيد true فوراً — فيغادر حارس الإغلاق الشاشة والكتابة ما زالت
  // جارية، وأي فشل بعدها يضيع بلا أثر. الآن لا تُقال «تم الحفظ» إلا بعد أن
  // يكتمل الحفظ فعلاً، ويُقال الفشل صراحةً.
  const onSave = async (): Promise<boolean> => {
    if (!mayWrite) {
      denied();
      return false;
    }
    if (!po.supplierCode) {
      toast.error("يجب اختيار المورد");
      return false;
    }
    const filled = po.rows.filter(isRealRow);
    if (!filled.length) {
      toast.error("يجب إضافة صنف واحد على الأقل");
      return false;
    }
    try {
      await savePurchaseOrder({ ...po, rows: filled });
    } catch (err) {
      console.error("savePurchaseOrder failed", err);
      toast.error("تعذّر حفظ أمر الشراء — لم تُكتب البيانات. المستند ما زال مفتوحاً أمامك.");
      return false;
    }
    setEditing(false);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    toast.success("تم حفظ أمر الشراء");
    return true;
  };
  // زر «تعديل» مفعّل دائماً — لا يُعطَّل لأن الأمر معتمد. الأمر المعتمد مستند
  // محاسبي لا يُعدَّل مباشرةً، فالزر يقول ذلك ويدلّ على «إلغاء الاعتماد» بدل أن
  // يبقى رمادياً بلا تفسير.
  const onEdit = () => {
    if (!mayWrite) return denied();
    if (po.approved) return toast.error("الأمر معتمد — اضغط «إلغاء الاعتماد» (Shift+F9) ثم عدّله");
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
  const onApprove = async () => {
    if (!mayApprove) return denied();
    const filled = po.rows.filter(isRealRow);
    if (!po.supplierCode || !filled.length) return toast.error("لا يمكن اعتماد أمر ناقص");
    const approved = { ...po, rows: filled, approved: true };
    // الاعتماد يكتب «آخر تكلفة» على كل صنف في الدليل — لا يجوز إعلان نجاحه قبل
    // أن تكتمل تلك الكتابة، ولا قفل الشاشة على حالة «معتمد» إن فشلت.
    try {
      await savePurchaseOrder(approved);
    } catch (err) {
      console.error("approve failed", err);
      return toast.error("تعذّر اعتماد أمر الشراء — لم تُكتب البيانات");
    }
    setPo(approved);
    setEditing(false);
    toast.success("تم اعتماد أمر الشراء");
  };
  /**
   * إلغاء الاعتماد: يعيد الأمر مستنداً قابلاً للتعديل. يمرّ بـ overwriteApproved
   * لأن طبقة الحفظ ترفض الكتابة فوق مستند معتمد — وهذا بالضبط الاستثناء المقصود:
   * فعلٌ صريح من صاحب صلاحية الاعتماد، لا تعديل صامت.
   * «آخر تكلفة» المكتوبة على الأصناف وقت الاعتماد تبقى كما هي حتى يُعتمد الأمر
   * من جديد فتُكتب من الأرقام الجديدة.
   */
  const onUnapprove = async () => {
    if (!mayApprove) return denied();
    if (!po.approved) return toast.info("الأمر غير معتمد أصلاً");
    if (!confirm(`إلغاء اعتماد الأمر ${po.number}؟ سيعود قابلاً للتعديل.`)) return;
    const draft = { ...po, approved: false };
    try {
      await savePurchaseOrder(draft, { overwriteApproved: true });
    } catch (err) {
      console.error("unapprove failed", err);
      return toast.error("تعذّر إلغاء الاعتماد — لم تُكتب البيانات");
    }
    setPo(draft);
    setEditing(true);
    toast.success("تم إلغاء الاعتماد — الأمر قابل للتعديل الآن");
  };
  // طباعة مستند الفاتورة كاملاً (بنود + مصروفات + مجاميع + تسعيرات) بدل
  // لقطة من الشاشة — انظر src/lib/print-po.ts.
  const onPrint = () =>
    printPurchaseOrder({
      po,
      supplier,
      companyName: settings.companyName || "أمر شراء",
      company: settings.company,
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

  // زر الاستيراد كان معطّلاً خارج وضع التعديل، فيضغطه المستخدم ولا يحدث شيء ولا
  // تُشرح له العلّة. صار يتصرّف كزر «إضافة سطر»: يفتح وضع التعديل بنفسه، ويقول
  // صراحةً لماذا يرفض حين يرفض. والاستيراد يستبدل كل الأسطر — فيُستأذن أولاً.
  const onImport = () => {
    if (!mayWrite) return denied();
    if (po.approved) return toast.error("الأمر معتمد — انسخه (Ctrl+D) ثم استورد في النسخة الجديدة");
    if (po.rows.some(isRealRow) && !confirm("سيستبدل الاستيراد كل أسطر الأمر الحالية. متابعة؟"))
      return;
    if (!editing) setEditing(true);
    fileRef.current?.click();
  };
  // «تحديث الأسعار»: يسحب أسعار الصرف من جدول العملات إلى الرأس وكل الأسطر
  // والمصروفات. بدونه يبقى المستند على السعر المثبَّت لحظة إضافة كل سطر، فيبدو
  // أن تعديل «أسعار الصرف» لا أثر له. المستند المحفوظ/المعتمد لا يُمسّ — الزر
  // معطّل خارج وضع التعديل تماماً كبقية حقول الشاشة.
  const onRefreshRates = () => {
    if (disabled) return;
    setPo((cur) => repinRates(cur));
    toast.success("تم تحديث أسعار الصرف على كل الأسطر والمصروفات — اضغط «حفظ» لتثبيتها");
  };
  const onCopy = async () => {
    if (!mayWrite) return denied();
    autoLoadedRef.current = true;
    const num = await nextInvoiceNumber();
    setPo({ ...po, number: num, invoiceNo: num, approved: false });
    setEditing(true);
    toast.success("تم نسخ الأمر - عدّل ثم احفظ");
  };
  // ---- استيراد Excel ----
  // يمرّ كلّه عبر `cell`/`numCell` (src/lib/sheet.ts) لسببين:
  //
  //  1. رأس عمود فيه مسافة زائدة أو باختلاف في حالة الأحرف — «الكمية » بدل
  //     «الكمية» — كان يفوت المطابقة الحرفية، فتُستورد أصفارٌ في كل الأسطر بصمت.
  //  2. `Number()` الخام يُنتج NaN من أي خلية نصية، وNaN يسري في كل الحسابات حتى
  //     مجاميع الفاتورة، ثم يعرضه `fmt()` رقماً هادئاً هو «0.00». الآن تُعدّ
  //     الخلايا غير المقروءة وتُقال للمستخدم بدل أن تُبتلع.
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

    let unreadable = 0;
    const rows: PORow[] = data.map((r, i) => {
      const pack = numCell(cell(r, "العبوة", "pack"), 1);
      const qty = numCell(cell(r, "الكمية", "qty"), 0);
      const price = numCell(cell(r, "سعر الشراء", "price"), 0);
      // يقبل رأس العمود الذي تصدّره هذه الشاشة نفسها («CBM الكرتون») و«CBM» المجرّد.
      const cbm = numCell(cell(r, "CBM الكرتون", "CBM", "cbm"), 0);
      unreadable += [pack, qty, price, cbm].filter((c) => c.bad).length;
      return {
        id: i + 1,
        model: String(cell(r, "الموديل", "model") ?? ""),
        name: String(cell(r, "اسم الصنف", "name") ?? ""),
        unit: String(cell(r, "الوحدة", "unit") ?? "حبة"),
        pack: pack.value,
        qty: qty.value,
        price: price.value,
        cbm: cbm.value,
      };
    });

    setPo({ ...po, rows });
    toast.success(`تم استيراد ${rows.length} صنف`);
    if (unreadable) {
      toast.warning(
        `${unreadable} خانة رقمية غير مقروءة في الملف — أُخذت بالقيمة الافتراضية. راجع أعمدة الكمية والسعر والعبوة وCBM.`,
        { duration: 8000 },
      );
    }
  };
  const onExport = () => {
    // Keep the ORIGINAL index for the rowMetrics lookup while dropping the blank
    // filler rows, so the sheet neither exports empty lines nor shifts costs.
    const data = po.rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => isRealRow(r))
      .map(({ r, i }, n) => ({
        م: n + 1,
        الموديل: r.model,
        "اسم الصنف": r.name,
        الوحدة: r.unit,
        العبوة: r.pack,
        الكمية: r.qty,
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

  // ── حارس الإغلاق ──
  // «بيانات غير محفوظة» = شاشة في وضع التعديل كُتب فيها شيء فعلاً. أمر معتمد
  // أو شاشة عرض فقط لا شيء فيها يُحفظ، فيكتفي الحارس بسؤال تأكيد بسيط.
  const hasUnsaved =
    editing && !po.approved && (Boolean(po.supplierCode) || po.rows.some(isRealRow));
  const saveDraft = () => {
    try {
      writeWebStorage(DRAFT_KEY, po);
      toast.success("تم حفظ المسودّة — ستُستعاد عند العودة إلى الشاشة");
    } catch {
      toast.error("تعذّر حفظ المسودّة");
    }
  };
  const dropDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };
  const closeGuard = useCloseGuard({
    dirty: hasUnsaved,
    title: `أمر الشراء ${po.number}`,
    onSave: mayWrite ? onSave : undefined,
    onSaveDraft: saveDraft,
    onDiscard: dropDraft,
  });

  const actions = [
    {
      icon: FilePlus2,
      label: "جديد",
      hint: "Ctrl+N",
      color: "text-emerald-600",
      onClick: onNew,
      disabled: !mayWrite,
    },
    {
      icon: Copy,
      label: "نسخ",
      hint: "Ctrl+D",
      color: "text-purple-600",
      onClick: onCopy,
      disabled: !mayWrite,
    },
    {
      icon: FolderOpen,
      label: "فتح",
      hint: "Ctrl+O",
      color: "text-amber-500",
      onClick: () => setOpenDlg(true),
    },
    {
      icon: Save,
      label: "حفظ",
      hint: "Ctrl+S",
      color: "text-blue-600",
      onClick: onSave,
      disabled: !editing || !mayWrite,
    },
    // لا `disabled` هنا عن قصد: الزر مفعّل دائماً ويشرح رفضه بنفسه (انظر onEdit).
    {
      icon: Pencil,
      label: "تعديل",
      hint: "F2",
      color: "text-cyan-600",
      onClick: onEdit,
    },
    {
      icon: Trash2,
      label: "حذف",
      hint: "Del",
      color: "text-rose-600",
      onClick: onDelete,
      disabled: !mayDelete,
    },
    {
      icon: Search,
      label: "بحث",
      hint: "F3",
      color: "text-indigo-500",
      onClick: () => {
        setItemsDlg(true);
        setSearchDlg(true);
      },
    },
    { icon: Printer, label: "طباعة", hint: "Ctrl+P", color: "text-slate-600", onClick: onPrint },
    // لا `disabled` هنا: onImport يفتح وضع التعديل بنفسه ويشرح رفضه — انظر تعريفه.
    {
      icon: FileSpreadsheet,
      label: "استيراد Excel",
      color: "text-green-600",
      onClick: onImport,
      disabled: po.approved || !mayWrite,
    },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    {
      icon: Wallet,
      label: "المصروفات",
      hint: "F4",
      color: "text-orange-600",
      onClick: () => setExpDlg(true),
    },
    { icon: Tags, label: "التسعيرات", hint: "F6", color: "text-fuchsia-600", onClick: onTiers },
    {
      icon: CheckCircle2,
      label: "اعتماد",
      hint: "F9",
      color: "text-emerald-700",
      onClick: onApprove,
      disabled: po.approved || !mayApprove,
    },
    {
      icon: Undo2,
      label: "إلغاء الاعتماد",
      hint: "Shift+F9",
      color: "text-amber-600",
      onClick: onUnapprove,
      disabled: !po.approved || !mayApprove,
    },
    {
      icon: X,
      label: "إغلاق",
      hint: "Esc",
      color: "text-rose-600",
      onClick: closeGuard.requestClose,
    },
  ];

  // Windows-like keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // قوائم البحث/الوحدات تتكفّل بمفاتيحها بنفسها (Enter للاختيار، Esc
      // للإغلاق، وF9 فتحها أصلاً) — فلا يجوز أن يلتقطها اختصار الشاشة فيعتمد
      // الأمرَ والمستخدم يتصفّح قائمة أصناف.
      if (lookup || unitDlg) {
        // Esc يغلق القائمة المفتوحة لا الشاشة — وهو المعالج الوحيد لها هنا،
        // فبقيّة المفاتيح تُترك للقائمة نفسها (↑↓ للتنقّل، Enter للاختيار).
        if (e.key === "Escape") {
          e.preventDefault();
          setLookup(null);
          setUnitDlg(null);
        }
        return;
      }
      // F9 داخل خانة موديل/اسم/وحدة يخصّ تلك الخانة (يفتح قائمتها) لا الشاشة.
      const inCell = e.target instanceof HTMLElement && e.target.hasAttribute("data-lookup-cell");
      if (inCell && e.key === "F9") return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "s") {
        e.preventDefault();
        if (editing) void onSave();
      } else if (e.ctrlKey && k === "n") {
        e.preventDefault();
        onNew();
      } else if (e.ctrlKey && k === "o") {
        e.preventDefault();
        setOpenDlg(true);
      } else if (e.ctrlKey && k === "p") {
        e.preventDefault();
        onPrint();
      } else if (e.key === "F2") {
        e.preventDefault();
        onEdit();
      } else if (e.key === "F3") {
        e.preventDefault();
        setItemsDlg(true);
        setSearchDlg(true);
      } else if (e.key === "F4") {
        e.preventDefault();
        setExpDlg(true);
      } else if (e.key === "F6") {
        e.preventDefault();
        onTiers();
      } else if (e.key === "F9") {
        e.preventDefault();
        if (e.shiftKey) void onUnapprove();
        else if (!po.approved) void onApprove();
      } else if (e.ctrlKey && k === "d") {
        e.preventDefault();
        onCopy();
      }
      // Esc كان يغلق النوافذ المنبثقة فقط، بينما تلميح زر «إغلاق» يَعِد بأنه
      // يغلق الشاشة. صار يفعل الاثنين بالترتيب الطبيعي: أقرب نافذة مفتوحة
      // أولاً، وإن لم تكن هناك نافذة فهو طلب إغلاق الشاشة (بسؤال).
      else if (e.key === "Escape") {
        if (closeGuard.pending) return; // نافذة السؤال نفسها تُغلق بـ Esc
        if (openDlg || supDlg || expDlg || searchDlg || itemsDlg) {
          setOpenDlg(false);
          setSupDlg(false);
          setExpDlg(false);
          setSearchDlg(false);
          setItemsDlg(false);
        } else closeGuard.requestClose();
      }
    };
    // طور الالتقاط لا الفقاعة: Radix يغلق نافذته المنبثقة على Escape ويُفرِغ
    // حالتها فوراً (حدث Escape حدثٌ متقطّع يُفرَّغ تفريغاً متزامناً)، فلو قرأ
    // هذا المعالج الحالة بعده لوجد كل النوافذ مغلقة وفهم Escape على أنه «أغلق
    // الشاشة» — فيقفز سؤال «بيانات غير محفوظة» لمجرّد إغلاق قائمة أصناف.
    // بالالتقاط يقرأ الحالة كما كانت لحظة الضغط فيغلق النافذة وحدها.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    po,
    editing,
    openDlg,
    supDlg,
    expDlg,
    searchDlg,
    itemsDlg,
    lookup,
    unitDlg,
    closeGuard.pending,
  ]);

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
    } catch {
      /* ignore */
    }
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
      try {
        writeWebStorage(DRAFT_KEY, po);
      } catch {
        // Swallowed on purpose: this fires every 400ms while typing, so a toast
        // here would stack dozens deep. writeWebStorage already reported a full
        // quota through onStorageFull, which the root shows once.
      }
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
      headers={[
        "م",
        "الموديل",
        "اسم الصنف",
        "الوحدة",
        "العبوة",
        "الكمية",
        "العملة",
        "سعر الشراء",
        "اجمالي امر الشراء",
        "تكلفة الشراء$",
        "CBM الكرتون",
        "إجمالي CBM",
        "تكلفة CBM $",
        "التكلفة المئوية $",
        "متوسط التكلفة $",
        "خرج للكرتون$",
        `سعر البيع (+${markupPct}%)`,
        "",
      ]}
      widths={[
        "2.2rem",
        "6.4rem",
        "250px",
        "3.6rem",
        "3.4rem",
        "3.4rem",
        "3.6rem",
        "3.6rem",
        "5rem",
        "3.8rem",
        "3.4rem",
        "4rem",
        "3.8rem",
        "3.8rem",
        "4.6rem",
        "4.6rem",
        "5rem",
        "2rem",
      ]}
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
          // قائمة الزر الأيمن على السطر: «حذف الصف» يحذف السطر وبياناته كلّها.
          <RowMenu key={r.id} onDelete={() => removeRow(r.id)} disabled={disabled}>
            <tr className="hover:bg-slate-50">
              <td className="border border-slate-200 text-center text-slate-500 w-8">{i + 1}</td>
              <td className="border border-slate-200 p-0">
                <LookupInput
                  value={r.model}
                  disabled={disabled}
                  onChange={(v) => patchRow(r.id, { model: v })}
                  onEnter={() => lookupFromCell(r.id, r.model, "code")}
                  onF9={() => setLookup({ rowId: r.id, sortBy: "code", term: "" })}
                  title="اكتب جزءاً من الرقم واضغط Enter للبحث — F9 لكل الأصناف مرتّبة بالرقم"
                  inputClass="text-[13px] font-semibold tabular-nums text-slate-800"
                />
              </td>
              <td className="border border-slate-200 p-0">
                <LookupInput
                  value={r.name}
                  disabled={disabled}
                  align="right"
                  onChange={(v) => patchRow(r.id, { name: v })}
                  onEnter={() => lookupFromCell(r.id, r.name, "name")}
                  onF9={() => setLookup({ rowId: r.id, sortBy: "name", term: "" })}
                  title="اكتب جزءاً من الاسم واضغط Enter للبحث — F9 لكل الأصناف مرتّبة بالاسم"
                  inputClass="text-[13px] font-semibold text-slate-800"
                />
              </td>
              <td className="border border-slate-200 p-0">
                <LookupInput
                  value={r.unit}
                  disabled={disabled}
                  onChange={(v) => patchRow(r.id, { unit: v })}
                  onF9={() => setUnitDlg({ rowId: r.id, model: r.model })}
                  title="F9 لعرض الوحدات المسجّلة بمرات الشراء والموردين والأسعار"
                />
              </td>
              <Cell
                value={r.pack}
                onChange={(v) => patchRow(r.id, { pack: parseDecimal(v) })}
                disabled={disabled}
                align="right"
                type="number"
              />
              <Cell
                value={r.qty}
                onChange={(v) => patchRow(r.id, { qty: parseDecimal(v) })}
                disabled={disabled}
                align="right"
                type="number"
              />
              <td className="border border-slate-200 p-0">
                <select
                  value={rowCur}
                  disabled={disabled}
                  onChange={(ev) =>
                    patchRow(r.id, { currency: ev.target.value, rate: rateOf(ev.target.value) })
                  }
                  className="w-full px-1 py-1 text-xs bg-white disabled:bg-slate-50 border-0 focus:outline-none"
                >
                  {currencyOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value}
                    </option>
                  ))}
                </select>
              </td>
              <Cell
                value={r.price}
                onChange={(v) => patchRow(r.id, { price: parseDecimal(v) })}
                disabled={disabled}
                align="right"
                type="number"
              />
              {/* إجمالي أمر الشراء = الكمية × العبوة × سعر الحبة، بعملة السطر */}
              <td className="border border-slate-200 text-right px-2 bg-slate-50 font-semibold text-slate-800">
                {fmtAuto(m?.lineInvoiceTotal ?? 0, 4)}
              </td>
              <Cell value={fmt(m?.purchaseCost ?? 0, 1)} align="right" />
              <Cell
                value={r.cbm}
                onChange={(v) => patchRow(r.id, { cbm: parseDecimal(v) })}
                disabled={disabled}
                align="right"
                type="number"
              />
              <Cell value={fmtAuto(cartons * r.cbm, 4)} align="right" />
              <td
                className={`border border-slate-200 text-right px-2 bg-slate-50 text-slate-700 ${dt === "cbm" ? "!bg-slate-200 font-bold" : ""}`}
              >
                {fmt(m?.cbmCost ?? 0, 1)}
              </td>
              <td
                className={`border border-slate-200 text-right px-2 bg-slate-50 text-slate-700 ${dt === "percentage" ? "!bg-slate-200 font-bold" : ""}`}
              >
                {fmt(m?.pctCost ?? 0, 1)}
              </td>
              <td
                className={`border border-slate-200 text-right px-2 bg-slate-50 text-slate-700 ${dt === "average" ? "!bg-slate-200 font-bold" : ""}`}
              >
                {fmt(m?.avgCost ?? 0, 1)}
              </td>
              <td className="border border-slate-200 text-right px-2 bg-slate-50 font-semibold text-slate-800">
                {fmt(m?.allocatedExpPerCarton ?? 0, 5)}
              </td>
              <SaleCell
                value={salePrice}
                overridden={saleOverridden}
                disabled={disabled}
                decimals={4}
                onChange={(v) =>
                  patchRow(r.id, { salePrice: v.trim() === "" ? undefined : parseDecimal(v) })
                }
              />
              <td className="border border-slate-200 text-center">
                <button
                  disabled={disabled}
                  onClick={() => removeRow(r.id)}
                  className="text-rose-600 hover:bg-rose-50 p-1 rounded disabled:opacity-40"
                  title="حذف"
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          </RowMenu>
        );
      })}
    </ErpTable>
  );

  return (
    <ErpLayout title="أمر شراء" ribbon={<Ribbon actions={actions} />}>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={onFile}
        className="hidden"
      />

      {/* Read-only mode isn't obvious from grayed-out fields alone — spell it out
          and offer the exact action needed, so the screen never looks "stuck". */}
      {!mayWrite && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-medium bg-slate-100 border-slate-300 text-slate-700">
          <Info size={14} className="shrink-0" />
          صلاحيتك <b>مطالع</b> — يمكنك عرض وطباعة وتصدير أوامر الشراء فقط، دون إنشاء أو تعديل أو
          اعتماد.
        </div>
      )}
      {!editing && mayWrite && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded border text-xs font-medium ${
            po.approved
              ? "bg-emerald-50 border-emerald-300 text-emerald-800"
              : "bg-amber-50 border-amber-300 text-amber-800"
          }`}
        >
          {po.approved ? (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="shrink-0" />
              هذا أمر شراء <b>معتمد</b> ولا يمكن تعديله. لإنشاء أمر جديد اضغط «جديد»، أو «نسخ»
              لإنشاء نسخة قابلة للتعديل منه.
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Info size={14} className="shrink-0" />
              الشاشة حالياً في <b>وضع العرض فقط</b> ولا يمكن الكتابة في الحقول — اضغط «جديد» لإنشاء
              أمر شراء جديد، أو «تعديل» لتعديل هذا الأمر.
            </span>
          )}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onNew}
              className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
            >
              <FilePlus2 size={12} /> جديد
            </button>
            {po.approved ? (
              <button
                onClick={onCopy}
                className="flex items-center gap-1 px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700"
              >
                <Copy size={12} /> نسخ
              </button>
            ) : (
              <button
                onClick={onEdit}
                className="flex items-center gap-1 px-2 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-700"
              >
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
                  <button
                    disabled={disabled}
                    onClick={() => setSupDlg(true)}
                    className="px-2 border border-slate-300 bg-slate-50 rounded disabled:opacity-40"
                  >
                    <Search size={13} />
                  </button>
                </div>
              </FieldRow>
              <FieldRow label="كود المورد">
                <ErpInput value={po.supplierCode} onChange={() => {}} disabled />
              </FieldRow>
              <FieldRow label="الدولة">
                <ErpInput value={supplier?.country ?? ""} onChange={() => {}} disabled />
              </FieldRow>
              <FieldRow label="المدينة">
                <ErpInput value={supplier?.city ?? ""} onChange={() => {}} disabled />
              </FieldRow>
              <FieldRow label="الهاتف">
                <ErpInput value={supplier?.phone ?? ""} onChange={() => {}} disabled />
              </FieldRow>
              <FieldRow label="البريد">
                <ErpInput value={supplier?.email ?? ""} onChange={() => {}} disabled />
              </FieldRow>
            </div>
          </div>
        </Panel>

        <Panel
          title={
            <StepTitle n={2} label="بيانات أمر الشراء" hint="رقم الفاتورة، العملة، طريقة التوزيع" />
          }
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <FieldRow label="رقم الفاتورة">
              <ErpInput
                value={po.number}
                onChange={(v) => patch({ number: v, invoiceNo: v })}
                disabled={po.approved}
                highlight
              />
            </FieldRow>
            <FieldRow label="التاريخ">
              <ErpInput value={po.date} onChange={(v) => patch({ date: v })} disabled={disabled} />
            </FieldRow>
            <FieldRow label="العملة">
              <ErpSelect
                value={po.currency}
                onChange={setDocCurrency}
                disabled={disabled}
                options={currencyOptions}
              />
            </FieldRow>
            <FieldRow label={`سعر صرف ⁦1 USD = ? ${po.currency}⁩`}>
              <div className="flex items-center gap-1">
                <ErpInput
                  value={String(po.rate)}
                  onChange={(v) => {
                    const n = parseDecimal(v);
                    if (!(n > 0)) return;
                    setDocRate(n);
                  }}
                  disabled={disabled}
                />
                <button
                  onClick={onRefreshRates}
                  disabled={disabled}
                  title="تحديث أسعار الصرف من جدول العملات على كل الأسطر والمصروفات"
                  className="shrink-0 p-1.5 border border-slate-300 rounded text-slate-600 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <RefreshCcw size={13} />
                </button>
              </div>
            </FieldRow>
            <FieldRow label="رقم الحاوية">
              <ErpInput
                value={po.containerNo}
                onChange={(v) => patch({ containerNo: v })}
                disabled={disabled}
              />
            </FieldRow>
            <FieldRow label="حجم الحاوية">
              <ErpInput
                value={po.containerSize}
                onChange={(v) => patch({ containerSize: v })}
                disabled={disabled}
              />
            </FieldRow>
            <FieldRow label="توزيع المصروفات">
              <ErpSelect
                value={po.distributionType}
                onChange={(v) => patch({ distributionType: v as any })}
                disabled={disabled}
                options={[
                  { value: "cbm", label: "حسب تكلفة CBM" },
                  { value: "percentage", label: "حسب التكلفة المئوية" },
                  { value: "average", label: "حسب متوسط التكلفة" },
                ]}
              />
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
              <ErpInput
                value={markupPct}
                onChange={(v) => setMarkupPct(parseDecimal(v))}
                disabled={disabled}
                type="number"
              />
            </FieldRow>
            <div className="col-span-2">
              <FieldRow label="الملاحظات">
                <textarea
                  value={po.notes}
                  onChange={(e) => patch({ notes: e.target.value })}
                  disabled={disabled}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:bg-slate-50 min-h-[50px]"
                />
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
          <span>
            إجمالي أمر الشراء:{" "}
            <span className="font-bold">{fmtAuto(metrics.totalInvoiceAmount, 4)}</span>{" "}
            {po.currency}
          </span>
        </div>
      </button>

      {/* نفس الجدول تحت سطره مباشرة — بنفس التصميم بالضبط (متغيّر واحد يُعرض هنا
          وداخل النافذة)، وبنفس مصدر البيانات فالتعديل في أي منهما يظهر في الآخر. */}
      <div className="bg-white border border-slate-300 rounded overflow-hidden -mt-1 w-max max-w-full">
        {itemsGrid}
      </div>

      {/* شاشة البنود المنبثقة */}
      <Dialog open={itemsDlg} onOpenChange={setItemsDlg}>
        <DialogContent dir="rtl" className="max-w-[97vw] p-0 gap-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (!editing) setEditing(true);
                  addRow();
                }}
                disabled={po.approved || !mayWrite}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40"
              >
                <Plus size={12} /> إضافة صنف
              </button>
              <button
                onClick={() => setSearchDlg(true)}
                disabled={po.approved || !mayWrite}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-blue-50 disabled:opacity-40"
              >
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
            <SummaryStat
              label="إجمالي أمر الشراء"
              value={fmtAuto(metrics.totalInvoiceAmount, 4)}
              unit={po.currency}
            />
            <SummaryStat label="إجمالي CBM" value={fmtAuto(metrics.totalCBM, 4)} unit="CBM" />
          </div>

          <div className="overflow-auto max-h-[60vh]">{itemsGrid}</div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white">
            <button
              onClick={() => {
                void onSave();
                setItemsDlg(false);
              }}
              disabled={!mayWrite || po.approved}
              className="flex items-center gap-1 px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
            >
              <Check size={16} /> حفظ
            </button>
            <button
              onClick={() => setItemsDlg(false)}
              className="px-4 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50"
            >
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
        <div
          className="flex items-center justify-between px-3 py-1 font-semibold text-slate-700 border-b border-slate-300"
          style={{ background: "var(--color-erp-panel-header)" }}
        >
          <div className="text-[11px] flex items-center gap-1">
            <Coins size={12} className="text-amber-600" />
            <span className="text-slate-600">العملة الرئيسية للإجمالي:</span>
            <select
              value={masterCurrency}
              onChange={(e) => setMasterCurrency(e.target.value)}
              className="px-2 py-0.5 text-[11px] border border-slate-300 rounded bg-white font-bold"
            >
              {currencyOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <StepBadge n={5} /> احتساب التكلفة النهائية
          </div>
          <div className="text-[10px] text-slate-500">
            1 USD = {fmt(masterCurrency === "USD" ? 1 : rateOfCode(masterCurrency) || 1, 4)}{" "}
            {masterCurrency}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 p-2">
          <SummaryStat label="عدد الأصناف" value={fmtInt(metrics.totalItems)} unit="صنف" />
          <SummaryStat label="إجمالي الكمية" value={fmtInt(metrics.totalQty)} />
          {/* مجموع عمود "إجمالي أمر الشراء" — قيمة الفاتورة بعملتها كما يصدرها المورد */}
          <SummaryStat
            label="إجمالي أمر الشراء"
            value={fmtAuto(metrics.totalInvoiceAmount, 4)}
            unit={po.currency}
          />
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
            لا يوجد CBM مُدخل على أي صنف، لذلك تعذّر التوزيع حسب CBM — تم توزيع المصروفات نسبةً إلى
            قيمة الشراء بدلاً من ذلك. أدخل CBM الكرتون لكل صنف لاعتماد التوزيع الحجمي.
          </div>
        )}
        {!metrics.allocationBalanced && (
          <div className="border-t border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-800 flex items-center gap-1.5">
            <Info size={13} className="shrink-0" />
            «نسبة المصاريف %» المُدخلة يدوياً توزّع <b>{fmt(metrics.allocatedExpenses)}</b> USD
            بينما إجمالي المصروفات الفعلي <b>{fmt(metrics.totalExpenses)}</b> USD (فرق{" "}
            <b>{fmt(metrics.allocationDiff)}</b>). اضغط زر إعادة الاحتساب بجوار الحقل لمطابقتهما.
          </div>
        )}
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between">
          <div className="text-[11px] text-slate-600">
            الإجمالي النهائي (بالدولار) محوّل تلقائيًا إلى{" "}
            <b className="text-slate-800">{masterCurrency}</b>
          </div>
          <div className="text-lg font-black text-slate-800">
            {fmt(
              metrics.totalCost * (masterCurrency === "USD" ? 1 : rateOfCode(masterCurrency) || 1),
            )}
            <span className="text-xs text-slate-500 mr-2">{masterCurrency}</span>
          </div>
        </div>
      </div>

      {/* التسعيرات حسب الوجهات لها شاشة مستقلة — المدخل الوحيد إليها زر
          «التسعيرات» (F6) في شريط الأوامر أعلاه، بلا سطر أو جدول هنا. */}

      {/* Dialogs */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>فتح أمر شراء</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-auto space-y-1">
            {orders.map((o) => (
              <button
                key={o.number}
                onClick={() => {
                  autoLoadedRef.current = true;
                  setPo(o);
                  setOpenDlg(false);
                  setEditing(false);
                }}
                className="w-full text-right px-3 py-2 border border-slate-200 rounded hover:bg-slate-100 flex justify-between"
              >
                <span className="text-xs text-slate-500">{o.date}</span>
                <span className="font-semibold">{o.number}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={supDlg} onOpenChange={setSupDlg}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>اختيار المورد</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-auto space-y-1">
            {suppliers
              .filter((s) => s.active)
              .map((s) => (
                <button
                  key={s.code}
                  onClick={() => {
                    patch({ supplierCode: s.code, currency: s.currency });
                    setSupDlg(false);
                  }}
                  className="w-full text-right px-3 py-2 border border-slate-200 rounded hover:bg-slate-100"
                >
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-xs text-slate-500">
                    {s.code} • {s.country}
                  </div>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={searchDlg} onOpenChange={setSearchDlg}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>البحث في الأصناف</DialogTitle>
          </DialogHeader>
          <input
            placeholder="موديل، باركود، أو اسم..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-right"
          />
          <div className="max-h-64 overflow-auto space-y-1">
            {items
              .filter((it) => itemMatches(it, searchTerm))
              .map((it) => (
                <button
                  key={it.code}
                  onClick={() => {
                    addRowFromItem(it);
                    setSearchDlg(false);
                  }}
                  className="w-full text-right p-2 border border-slate-200 rounded hover:bg-slate-100"
                >
                  <div className="font-semibold">{it.name}</div>
                  <div className="text-xs text-slate-500">
                    {it.code} • {it.barcode}
                  </div>
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
            // A floating promise here swallowed every failure — the dialog said
            // "تم الحفظ" whether or not anything reached storage.
            savePurchaseOrder({ ...next, rows: next.rows.filter(isRealRow) }).catch((err) => {
              console.error("saving expenses onto the order failed", err);
              toast.error(
                err instanceof ApprovedDocumentError
                  ? err.message
                  : "تعذّر حفظ المصروفات — لم تُكتب البيانات",
              );
            });
          }
        }}
        onSaveExpenseTypes={(types) =>
          erpStore.set({ settings: { ...settings, expenseTypes: types } })
        }
      />

      {/* قائمة الأصناف (Enter/F9 من خانة الموديل أو الاسم) */}
      <ItemsLookupDialog
        open={Boolean(lookup)}
        onOpenChange={(v) => {
          if (!v) setLookup(null);
        }}
        items={items}
        initialTerm={lookup?.term ?? ""}
        sortBy={lookup?.sortBy ?? "code"}
        onPick={(it) => lookup && applyItem(lookup.rowId, it)}
      />

      {/* قائمة الوحدات المسجّلة (F9 من خانة الوحدة) */}
      <UnitsLookupDialog
        open={Boolean(unitDlg)}
        onOpenChange={(v) => {
          if (!v) setUnitDlg(null);
        }}
        items={items}
        orders={orders}
        suppliers={suppliers}
        model={unitDlg?.model ?? ""}
        onPick={(u) => unitDlg && patchRow(unitDlg.rowId, { unit: u })}
      />

      {closeGuard.dialog}
    </ErpLayout>
  );
}

function SummaryStat({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`border rounded p-2 text-center shadow-sm ${highlight ? "bg-slate-100 border-slate-300" : "bg-white border-slate-200"}`}
    >
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="font-bold text-slate-800 text-sm tabular-nums">
        {value} {unit && <span className="text-[10px] text-slate-500 font-normal">{unit}</span>}
      </div>
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
