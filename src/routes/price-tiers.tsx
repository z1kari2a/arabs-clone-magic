// شاشة «التسعيرات حسب الوجهات» — كانت جدولاً في أسفل شاشة أمر الشراء، وصارت
// شاشة مستقلة يُنتقل إليها بزر «التسعيرات» في شريط أوامر أمر الشراء.
//
// الشاشة للعرض والطباعة فقط: التكاليف تأتي من احتساب أمر الشراء (computePO)،
// وقواعد التسعير (النسبة الإضافية ونسبة الربح لكل وجهة) تُعرَّف في الإعدادات.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  FolderOpen,
  Printer,
  Download,
  X,
  Tags,
  Settings as SettingsIcon,
  ClipboardList,
  Info,
  Coins,
  Search,
} from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { useCloseGuard } from "@/components/erp/CloseGuard";
import { ErpTable, fmt } from "@/components/erp/ErpUI";
import { useErpStore, computePO, readStashedPO } from "@/lib/erp-store";
import { printPriceTiers } from "@/lib/print-po";
import type { PurchaseOrder } from "@/lib/erp-types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const searchSchema = z.object({ po: z.string().optional() });

export const Route = createFileRoute("/price-tiers")({
  head: () => ({
    meta: [
      { title: "التسعيرات - نظام ERP" },
      { name: "description", content: "التسعيرات حسب الوجهات لأصناف أمر الشراء" },
      { property: "og:title", content: "التسعيرات - نظام ERP" },
      { property: "og:description", content: "شاشة التسعيرات حسب الوجهات" },
    ],
  }),
  validateSearch: searchSchema.parse,
  component: PriceTiersPage,
});

function PriceTiersPage() {
  const router = useRouter();
  const { po: poNumber } = Route.useSearch();
  const orders = useErpStore((s) => s.purchaseOrders);
  const suppliers = useErpStore((s) => s.suppliers);
  const settings = useErpStore((s) => s.settings);
  const hydrated = useErpStore((s) => s.hydrated);
  const priceTiers = settings.priceTiers ?? [];
  const currencies = settings.currencies ?? [];
  const rateOfCode = (code: string) => currencies.find((c) => c.code === code)?.rate ?? 1;
  const currencyOptions = currencies.length
    ? currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))
    : [{ value: "USD", label: "USD" }];

  const [selected, setSelected] = useState<string | undefined>(poNumber);
  const [displayCurrency, setDisplayCurrency] = useState("USD");
  const [openDlg, setOpenDlg] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (poNumber) setSelected(poNumber);
  }, [poNumber]);

  // أول فاتورة محفوظة تُعرض تلقائياً عند الدخول بلا رقم — لكن فقط بعد أن
  // ينتهي تحميل المخزن، وإلا ظهرت الشاشة فارغة على أنه «لا توجد فواتير».
  useEffect(() => {
    if (!hydrated || selected || !orders.length) return;
    setSelected(orders[0].number);
  }, [hydrated, orders, selected]);

  // الفاتورة المطلوبة: من المحفوظات أولاً، وإلا من النسخة المُمرَّرة من شاشة
  // أمر الشراء (فاتورة تحت التحرير لم تُحفظ بعد).
  const po: PurchaseOrder | null = useMemo(() => {
    const saved = orders.find((o) => o.number === selected);
    if (saved) return saved;
    const stashed = readStashedPO();
    if (stashed && (!selected || stashed.number === selected)) return stashed;
    return null;
  }, [orders, selected]);

  const metrics = useMemo(() => (po ? computePO(po) : null), [po]);
  const supplier = suppliers.find((s) => s.code === po?.supplierCode);
  const isDraft = Boolean(po && !orders.some((o) => o.number === po.number));
  const conv = displayCurrency === "USD" ? 1 : rateOfCode(displayCurrency) || 1;

  // التكلفة المعتمدة لكل صنف بعملة العرض. rowMetrics مفهرس على po.rows الأصلي،
  // فنحتفظ بالفهرس الأصلي قبل استبعاد الأسطر الفارغة.
  const rows = useMemo(() => {
    if (!po || !metrics) return [];
    const term = filter.trim();
    return po.rows
      .map((r, srcIndex) => ({ r, srcIndex }))
      .filter(({ r }) => r.model || r.name)
      .filter(({ r }) => !term || r.model.includes(term) || r.name.includes(term))
      .map(({ r, srcIndex }) => ({
        r,
        cost: (metrics.rowMetrics[srcIndex]?.selectedCost ?? 0) * conv,
      }));
  }, [po, metrics, filter, conv]);

  const onPrint = () => {
    if (!po) return toast.error("اختر فاتورة أولاً");
    printPriceTiers({
      po,
      supplier,
      companyName: settings.companyName || "التسعيرات",
      company: settings.company,
      priceTiers,
      displayCurrency,
      displayRate: conv,
    });
  };

  const onExport = () => {
    if (!po) return toast.error("اختر فاتورة أولاً");
    if (!rows.length) return toast.error("لا توجد أصناف للتصدير");
    const data = rows.map(({ r, cost }, i) => {
      const line: Record<string, string | number> = {
        م: i + 1,
        الموديل: r.model,
        "اسم الصنف": r.name,
        [`التكلفة المعتمدة (${displayCurrency})`]: cost,
      };
      for (const t of priceTiers) {
        const tierCost = cost * (1 + (t.extraPct || 0) / 100);
        line[`تكلفة ${t.name}`] = tierCost;
        line[`بيع ${t.name}`] = tierCost * (1 + (t.profitPct || 0) / 100);
      }
      return line;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "التسعيرات");
    XLSX.writeFile(wb, `تسعيرات-${po.number}.xlsx`);
    toast.success("تم التصدير إلى Excel");
  };

  const backToPO = () => router.navigate({ to: "/purchase-order" });

  // شاشة عرض: لا بيانات معلّقة تُحفظ، فيكتفي الحارس بسؤال تأكيد قبل الإغلاق.
  const closeGuard = useCloseGuard({ title: "التسعيرات" });

  const actions = [
    {
      icon: FolderOpen,
      label: "فتح فاتورة",
      hint: "Ctrl+O",
      color: "text-amber-500",
      onClick: () => setOpenDlg(true),
    },
    {
      icon: Printer,
      label: "طباعة",
      hint: "Ctrl+P",
      color: "text-slate-600",
      onClick: onPrint,
      disabled: !po,
    },
    {
      icon: Download,
      label: "تصدير Excel",
      color: "text-teal-600",
      onClick: onExport,
      disabled: !po,
    },
    {
      icon: SettingsIcon,
      label: "تعريف التسعيرات",
      color: "text-indigo-600",
      onClick: () => router.navigate({ to: "/settings" }),
    },
    { icon: ClipboardList, label: "أمر الشراء", color: "text-blue-600", onClick: backToPO },
    {
      icon: X,
      label: "إغلاق",
      hint: "Esc",
      color: "text-rose-600",
      onClick: closeGuard.requestClose,
    },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "o") {
        e.preventDefault();
        setOpenDlg(true);
      } else if (e.ctrlKey && k === "p") {
        e.preventDefault();
        onPrint();
      } else if (e.key === "Escape") {
        if (closeGuard.pending) return;
        if (openDlg) setOpenDlg(false);
        else closeGuard.requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po, displayCurrency, priceTiers, openDlg, closeGuard.pending]);

  return (
    <ErpLayout title="التسعيرات حسب الوجهات" ribbon={<Ribbon actions={actions} />}>
      {/* شريط الفاتورة المعروضة + عملة العرض */}
      <div className="bg-white border border-slate-300 rounded">
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-300"
          style={{ background: "var(--color-erp-panel-header)" }}
        >
          <div className="flex items-center gap-2 text-[11px]">
            <Coins size={12} className="text-amber-600" />
            <span className="text-slate-600">عرض التسعيرات بعملة:</span>
            <select
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value)}
              className="px-2 py-0.5 text-[11px] border border-slate-300 rounded bg-white font-bold"
            >
              {currencyOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-slate-500">
              1 USD = {fmt(conv, 4)} {displayCurrency}
            </span>
          </div>
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <Tags size={14} className="text-fuchsia-600" />
            التسعيرات حسب الوجهات
          </div>
          <button
            onClick={() => setOpenDlg(true)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-amber-500 text-white rounded hover:bg-amber-600"
          >
            <FolderOpen size={12} /> اختيار الفاتورة
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 p-2 text-xs">
          <InfoBox label="رقم الفاتورة" value={po?.number ?? "—"} />
          <InfoBox label="التاريخ" value={po?.date ?? "—"} />
          <InfoBox label="المورد" value={supplier?.name ?? po?.supplierCode ?? "—"} />
          <InfoBox label="عدد الأصناف" value={String(rows.length)} />
          <InfoBox label="إجمالي التكلفة" value={`${fmt(metrics?.totalCost ?? 0)} USD`} />
        </div>

        {isDraft && po && (
          <div className="border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 flex items-center gap-1.5">
            <Info size={13} className="shrink-0" />
            هذه فاتورة قيد التحرير ولم تُحفظ بعد — التسعيرات محسوبة على بياناتها الحالية، واحفظها من
            شاشة أمر الشراء لتثبيتها.
          </div>
        )}
      </div>

      {/* قواعد التسعير المعرّفة في الإعدادات */}
      {priceTiers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {priceTiers.map((t) => (
            <div
              key={t.id}
              className="bg-white border border-slate-300 rounded px-3 py-1.5 text-[11px]"
            >
              <div className="font-semibold text-slate-800">{t.name}</div>
              <div className="text-slate-500">
                إضافة على التكلفة <b className="text-slate-700">{fmt(t.extraPct || 0, 2)}%</b>
                {" • "}ربح <b className="text-emerald-700">{fmt(t.profitPct || 0, 2)}%</b>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* الجدول */}
      {priceTiers.length === 0 ? (
        <EmptyState
          text="لا توجد تسعيرات معرّفة. عرّف وجهات التسعير (اسم الوجهة، النسبة الإضافية، نسبة الربح) من شاشة الإعدادات."
          actionLabel="فتح الإعدادات"
          onAction={() => router.navigate({ to: "/settings" })}
        />
      ) : !po ? (
        <EmptyState
          text="لم تُختر فاتورة بعد. اختر أمر شراء لعرض تسعيرات أصنافه."
          actionLabel="اختيار الفاتورة"
          onAction={() => setOpenDlg(true)}
        />
      ) : (
        <div className="bg-white border border-slate-300 rounded">
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-300">
            <Search size={13} className="text-slate-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="تصفية بالموديل أو اسم الصنف..."
              className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded text-right"
            />
            <span className="text-[11px] text-slate-500 shrink-0">{rows.length} صنف</span>
          </div>
          <div className="overflow-auto">
            <ErpTable
              headers={[
                "م",
                "الموديل",
                "اسم الصنف",
                `التكلفة المعتمدة (${displayCurrency})`,
                ...priceTiers.flatMap((t) => [`تكلفة ${t.name}`, `بيع ${t.name}`]),
              ]}
            >
              {rows.map(({ r, cost }, i) => (
                <tr key={r.id} className="odd:bg-white even:bg-slate-50/50">
                  <td className="border border-slate-200 text-center text-slate-500 w-10">
                    {i + 1}
                  </td>
                  <td className="border border-slate-200 text-center px-2">{r.model}</td>
                  <td className="border border-slate-200 text-right px-2">{r.name}</td>
                  <td className="border border-slate-200 text-right px-2 bg-slate-50 font-semibold">
                    {fmt(cost, 4)}
                  </td>
                  {priceTiers.flatMap((t) => {
                    const tierCost = cost * (1 + (t.extraPct || 0) / 100);
                    const salePrice = tierCost * (1 + (t.profitPct || 0) / 100);
                    return [
                      <td key={t.id + "c"} className="border border-slate-200 text-right px-2">
                        {fmt(tierCost, 4)}
                      </td>,
                      <td
                        key={t.id + "s"}
                        className="border border-slate-200 text-right px-2 bg-slate-100 font-semibold text-slate-800"
                      >
                        {fmt(salePrice, 4)}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </ErpTable>
          </div>
          {rows.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-slate-500">لا توجد أصناف مطابقة</div>
          )}
        </div>
      )}

      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>اختيار أمر الشراء</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-auto space-y-1">
            {orders.length === 0 && (
              <div className="text-xs text-slate-500 text-center py-4">
                لا توجد أوامر شراء محفوظة
              </div>
            )}
            {orders.map((o) => (
              <button
                key={o.number}
                onClick={() => {
                  setSelected(o.number);
                  setOpenDlg(false);
                  router.navigate({ to: "/price-tiers", search: { po: o.number } });
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
      {closeGuard.dialog}
    </ErpLayout>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded p-2 bg-white shadow-sm">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="font-bold text-slate-800 text-sm truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function EmptyState({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="bg-white border border-slate-300 rounded px-4 py-8 text-center space-y-3">
      <div className="text-xs text-slate-600 flex items-center justify-center gap-1.5">
        <Info size={14} className="text-slate-400" /> {text}
      </div>
      <button
        onClick={onAction}
        className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        {actionLabel}
      </button>
    </div>
  );
}
