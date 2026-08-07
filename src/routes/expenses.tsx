import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  Wallet,
  Printer,
  Download,
  Search,
  X,
  TrendingUp,
  PieChart as PieIcon,
  BarChart3,
  Layers,
  Filter,
  RefreshCw,
  DollarSign,
  Package,
  Building2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { ErpTable, fmt, fmtInt } from "@/components/erp/ErpUI";
import { useErpStore, computePO, erpStore, savePurchaseOrder } from "@/lib/erp-store";
import ExpensesDialog from "@/components/erp/ExpensesDialog";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/expenses")({
  head: () => ({
    meta: [
      { title: "المصروفات - نظام ERP" },
      { name: "description", content: "شاشة إدارة المصروفات مع إحصاءات ورسوم بيانية" },
      { property: "og:title", content: "المصروفات - نظام ERP" },
      { property: "og:description", content: "لوحة تحليلية للمصروفات على أوامر الشراء" },
    ],
  }),
  component: ExpensesPage,
});

const PIE_COLORS = ["#2563eb", "#f97316", "#10b981", "#eab308", "#a855f7", "#ef4444", "#06b6d4", "#84cc16", "#ec4899", "#6366f1"];

/** Purchase orders store dates as YYYY/MM/DD; date inputs speak YYYY-MM-DD.
 *  Normalise to the ISO form so the two are string-comparable. */
const normalizeDate = (d: string) => (d || "").replace(/\//g, "-");

function ExpensesPage() {
  const orders = useErpStore((s) => s.purchaseOrders);
  const suppliers = useErpStore((s) => s.suppliers);
  const settings = useErpStore((s) => s.settings);
  const currencies = settings.currencies ?? [];

  const [expDlg, setExpDlg] = useState(false);
  const [targetPO, setTargetPO] = useState<string>("");

  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("");
  const [supplier, setSupplier] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "draft">("all");

  const allExpenses = useMemo(() => {
    return orders.flatMap((o) => {
      return o.expenses.map((e) => {
        const er = e.rate || currencies.find((c) => c.code === e.currency)?.rate || 0;
        return {
          po: o,
          e,
          // Base = USD, rate = units-per-USD → expenses always convert straight to USD.
          invAmount: er > 0 ? e.amount / er : 0,
          supplierName: suppliers.find((s) => s.code === o.supplierCode)?.name ?? "-",
        };
      });
    });
  }, [orders, suppliers, currencies]);

  const filtered = useMemo(() => {
    return allExpenses.filter(({ po, e, supplierName }) => {
      if (statusFilter === "approved" && !po.approved) return false;
      if (statusFilter === "draft" && po.approved) return false;
      if (type && e.type !== type) return false;
      if (supplier && po.supplierCode !== supplier) return false;
      // po.date is stored as YYYY/MM/DD while <input type="date"> yields
      // YYYY-MM-DD. Comparing them as raw strings compared "/" (47) against
      // "-" (45), so every in-range order tested as ABOVE the "to" bound and
      // the filter silently emptied the report. Normalise both to YYYY-MM-DD.
      const poDate = normalizeDate(po.date);
      if (from && poDate < from) return false;
      if (to && poDate > to) return false;
      if (q) {
        const s = q.toLowerCase();
        if (
          !`${e.type} ${e.note} ${po.number} ${supplierName}`.toLowerCase().includes(s)
        )
          return false;
      }
      return true;
    });
  }, [allExpenses, q, type, supplier, from, to, statusFilter]);

  const stats = useMemo(() => {
    const total = filtered.reduce((s, r) => s + r.invAmount, 0);
    const count = filtered.length;
    const ordersSet = new Set(filtered.map((r) => r.po.number));
    const avgPerOrder = ordersSet.size ? total / ordersSet.size : 0;
    const avgPerLine = count ? total / count : 0;

    // Total purchase value across involved orders for % ratio
    let totalPurchase = 0;
    ordersSet.forEach((num) => {
      const o = orders.find((x) => x.number === num);
      if (o) totalPurchase += computePO(o).totalPurchase;
    });
    let totalCBM = 0;
    ordersSet.forEach((num) => {
      const o = orders.find((x) => x.number === num);
      if (o) totalCBM += computePO(o).totalCBM;
    });
    const cbmCost = totalCBM > 0 ? total / totalCBM : 0;

    const byType = new Map<string, number>();
    filtered.forEach((r) => byType.set(r.e.type, (byType.get(r.e.type) || 0) + r.invAmount));
    const byTypeArr = [...byType.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const bySupplier = new Map<string, number>();
    filtered.forEach((r) =>
      bySupplier.set(r.supplierName, (bySupplier.get(r.supplierName) || 0) + r.invAmount)
    );
    const bySupplierArr = [...bySupplier.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const byCurrency = new Map<string, number>();
    filtered.forEach((r) =>
      byCurrency.set(r.e.currency || "-", (byCurrency.get(r.e.currency || "-") || 0) + r.e.amount)
    );
    const byCurrencyArr = [...byCurrency.entries()].map(([name, value]) => ({ name, value }));

    const byMonth = new Map<string, number>();
    filtered.forEach((r) => {
      const m = normalizeDate(r.po.date).slice(0, 7) || "غير محدد";
      byMonth.set(m, (byMonth.get(m) || 0) + r.invAmount);
    });
    const byMonthArr = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, value]) => ({ name, value }));

    const byOrder = new Map<string, { number: string; supplier: string; amount: number; date: string }>();
    filtered.forEach((r) => {
      const cur = byOrder.get(r.po.number);
      if (cur) cur.amount += r.invAmount;
      else
        byOrder.set(r.po.number, {
          number: r.po.number,
          supplier: r.supplierName,
          date: r.po.date,
          amount: r.invAmount,
        });
    });
    const byOrderArr = [...byOrder.values()].sort((a, b) => b.amount - a.amount);

    return {
      total,
      count,
      ordersCount: ordersSet.size,
      avgPerOrder,
      avgPerLine,
      totalPurchase,
      cbmCost,
      totalCBM,
      byTypeArr,
      bySupplierArr,
      byCurrencyArr,
      byMonthArr,
      byOrderArr,
    };
  }, [filtered, orders]);

  const types = useMemo(() => {
    const set = new Set<string>();
    allExpenses.forEach((r) => r.e.type && set.add(r.e.type));
    return [...set].sort();
  }, [allExpenses]);

  const onReset = () => {
    setQ(""); setType(""); setSupplier(""); setFrom(""); setTo(""); setStatusFilter("all");
  };

  const onExport = () => {
    const rows = filtered.map((r) => ({
      "رقم الفاتورة": r.po.number,
      "التاريخ": r.po.date,
      "المورد": r.supplierName,
      "الحالة": r.po.approved ? "معتمد" : "مسودة",
      "النوع": r.e.type,
      "البيان": r.e.note,
      "العملة": r.e.currency,
      "المبلغ الأصلي": r.e.amount,
      "سعر الصرف": r.e.rate,
      "بالدولار": r.invAmount,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expenses");
    XLSX.writeFile(wb, `expenses-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("تم تصدير المصروفات");
  };

  const actions = [
    { icon: RefreshCw, label: "تحديث", color: "text-emerald-600", onClick: () => toast.info("تم التحديث") },
    { icon: Plus, label: "إضافة مصروف", color: "text-emerald-600", onClick: () => {
        if (!orders.length) { toast.error("لا توجد أوامر شراء - أنشئ أمر شراء أولاً"); return; }
        setTargetPO(orders[0].number); setExpDlg(true);
      } },
    { icon: Filter, label: "تصفية", color: "text-blue-600", onClick: () => document.getElementById("exp-filter-q")?.focus() },
    { icon: Search, label: "بحث", hint: "F3", color: "text-indigo-500", onClick: () => document.getElementById("exp-filter-q")?.focus() },
    { icon: Printer, label: "طباعة", hint: "Ctrl+P", color: "text-slate-600", onClick: () => window.print() },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: onExport },
    { icon: X, label: "مسح الفلاتر", color: "text-orange-600", onClick: onReset },
  ];

  return (
    <ErpLayout title="المصروفات" ribbon={<Ribbon actions={actions} />}>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard label="إجمالي المصروفات" value={fmt(stats.total)} icon={Wallet} tone="bg-blue-50 text-blue-700 border-blue-200" sub="USD" />
        <StatCard label="عدد بنود المصروفات" value={fmtInt(stats.count)} icon={Layers} tone="bg-emerald-50 text-emerald-700 border-emerald-200" />
        <StatCard label="عدد الأوامر" value={fmtInt(stats.ordersCount)} icon={Package} tone="bg-indigo-50 text-indigo-700 border-indigo-200" />
        <StatCard label="متوسط/أمر شراء" value={fmt(stats.avgPerOrder)} icon={TrendingUp} tone="bg-amber-50 text-amber-700 border-amber-200" />
        <StatCard label="متوسط/بند" value={fmt(stats.avgPerLine)} icon={DollarSign} tone="bg-teal-50 text-teal-700 border-teal-200" />
        <StatCard label="سعر CBM" value={fmt(stats.cbmCost, 2)} icon={BarChart3} tone="bg-rose-50 text-rose-700 border-rose-200" sub="USD" />
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-300 rounded p-2 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
        <FilterField label="بحث">
          <input id="exp-filter-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="نوع/بيان/رقم أمر/مورد"
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white outline-none focus:ring-1 focus:ring-blue-400 text-right" />
        </FilterField>
        <FilterField label="نوع المصروف">
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white text-right">
            <option value="">— الكل —</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </FilterField>
        <FilterField label="المورد">
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white text-right">
            <option value="">— الكل —</option>
            {suppliers.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="من تاريخ">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white" />
        </FilterField>
        <FilterField label="إلى تاريخ">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white" />
        </FilterField>
        <FilterField label="الحالة">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white text-right">
            <option value="all">الكل</option>
            <option value="approved">معتمد</option>
            <option value="draft">مسودة</option>
          </select>
        </FilterField>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <ChartPanel title="المصروفات حسب النوع" icon={PieIcon}>
          {stats.byTypeArr.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={stats.byTypeArr} dataKey="value" nameKey="name" outerRadius={80} label={(d) => d.name}>
                  {stats.byTypeArr.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <ChartPanel title="المصروفات حسب المورد" icon={BarChart3}>
          {stats.bySupplierArr.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stats.bySupplierArr.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <ChartPanel title="اتجاه المصروفات شهريًا" icon={TrendingUp}>
          {stats.byMonthArr.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={stats.byMonthArr}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Line type="monotone" dataKey="value" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
      </div>

      {/* Detail + top orders */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <div className="lg:col-span-2 bg-white border border-slate-300 rounded">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
            <Wallet size={14} />
            <span className="font-semibold text-slate-700 text-xs">تفاصيل بنود المصروفات ({fmtInt(filtered.length)})</span>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <ErpTable headers={["م", "رقم الفاتورة", "التاريخ", "المورد", "النوع", "البيان", "العملة", "المبلغ", "السعر", "بالدولار", "الحالة"]}>
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center py-6 text-slate-500 text-xs">لا توجد مصروفات مطابقة للفلاتر</td></tr>
              )}
              {filtered.map((r, i) => (
                <tr key={r.po.number + r.e.id + i} className="hover:bg-blue-50/40">
                  <td className="border border-slate-200 text-center">{i + 1}</td>
                  <td className="border border-slate-200 px-2">{r.po.number}</td>
                  <td className="border border-slate-200 px-2">{r.po.date}</td>
                  <td className="border border-slate-200 px-2 text-right">{r.supplierName}</td>
                  <td className="border border-slate-200 px-2 text-right">{r.e.type}</td>
                  <td className="border border-slate-200 px-2 text-right">{r.e.note}</td>
                  <td className="border border-slate-200 px-2 text-center">{r.e.currency}</td>
                  <td className="border border-slate-200 px-2 text-right">{fmt(r.e.amount)}</td>
                  <td className="border border-slate-200 px-2 text-right">{fmt(r.e.rate || 1, 4)}</td>
                  <td className="border border-slate-200 px-2 text-right bg-amber-50 font-semibold">{fmt(r.invAmount)}</td>
                  <td className="border border-slate-200 text-center">
                    {r.po.approved
                      ? <span className="text-emerald-600 text-[11px]">معتمد</span>
                      : <span className="text-amber-600 text-[11px]">مسودة</span>}
                  </td>
                </tr>
              ))}
            </ErpTable>
          </div>
        </div>

        <div className="bg-white border border-slate-300 rounded">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
            <Building2 size={14} />
            <span className="font-semibold text-slate-700 text-xs">أعلى أوامر شراء بالمصروفات</span>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <ErpTable headers={["#", "رقم الفاتورة", "المورد", "التاريخ", "المجموع"]}>
              {stats.byOrderArr.length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-slate-500 text-xs">لا توجد بيانات</td></tr>
              )}
              {stats.byOrderArr.slice(0, 12).map((o, i) => (
                <tr key={o.number}>
                  <td className="border border-slate-200 text-center">{i + 1}</td>
                  <td className="border border-slate-200 px-2">{o.number}</td>
                  <td className="border border-slate-200 px-2 text-right">{o.supplier}</td>
                  <td className="border border-slate-200 px-2">{o.date}</td>
                  <td className="border border-slate-200 px-2 text-right bg-amber-50 font-semibold">{fmt(o.amount)}</td>
                </tr>
              ))}
            </ErpTable>
          </div>

          {stats.byCurrencyArr.length > 0 && (
            <div className="border-t border-slate-200 p-2">
              <div className="text-[11px] font-semibold text-slate-600 mb-1">الإجماليات حسب العملة الأصلية</div>
              <div className="space-y-1">
                {stats.byCurrencyArr.map((c) => (
                  <div key={c.name} className="flex items-center justify-between text-xs px-2 py-1 bg-slate-50 rounded border border-slate-200">
                    <span className="font-semibold">{c.name}</span>
                    <span className="tabular-nums">{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {expDlg && (() => {
        const po = orders.find((o) => o.number === targetPO);
        if (!po) return null;
        return (
          <>
            {/* PO selector chip above dialog */}
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-white border border-slate-300 rounded-full shadow px-3 py-1 flex items-center gap-2 text-xs">
              <span className="text-slate-500">إضافة إلى:</span>
              <select value={targetPO} onChange={(e) => setTargetPO(e.target.value)}
                className="px-2 py-1 border border-slate-300 rounded bg-white">
                {orders.map((o) => (
                  <option key={o.number} value={o.number}>{o.number} {o.approved ? "✓" : ""}</option>
                ))}
              </select>
            </div>
            <ExpensesDialog
              open={expDlg}
              onOpenChange={setExpDlg}
              expenses={po.expenses}
              invoiceCurrency={po.currency}
              currencies={currencies}
              expenseTypes={settings.expenseTypes ?? []}
              disabled={po.approved}
              onSave={(rows) => { savePurchaseOrder({ ...po, expenses: rows }); }}
              onSaveExpenseTypes={(types) => erpStore.set({ settings: { ...settings, expenseTypes: types } })}
              title={`مصروفات الفاتورة ${po.number}`}
            />
          </>
        );
      })()}
    </ErpLayout>
  );
}

function StatCard({ label, value, icon: Icon, tone, sub }: { label: string; value: string; icon: any; tone: string; sub?: string }) {
  return (
    <div className={`border rounded p-2 flex items-center gap-2 ${tone}`}>
      <div className="w-8 h-8 rounded bg-white/70 flex items-center justify-center">
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] opacity-80 truncate">{label}</div>
        <div className="text-sm font-bold tabular-nums truncate">{value} <span className="text-[10px] font-normal opacity-70">{sub}</span></div>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-slate-600 mb-0.5 text-right">{label}</div>
      {children}
    </div>
  );
}

function ChartPanel({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-300 rounded">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-300" style={{ background: "var(--color-erp-panel-header)" }}>
        <Icon size={14} />
        <span className="font-semibold text-slate-700 text-xs">{title}</span>
      </div>
      <div className="p-2">{children}</div>
    </div>
  );
}

function EmptyChart() {
  return <div className="h-[240px] flex items-center justify-center text-slate-400 text-xs">لا توجد بيانات لعرضها</div>;
}