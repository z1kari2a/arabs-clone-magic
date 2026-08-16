import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  ShoppingCart,
  ClipboardPen,
  Building2,
  Package,
  BarChart3,
  Users,
  Settings as SettingsIcon,
  Wallet,
  TrendingUp,
} from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import { useErpStore, computePO } from "@/lib/erp-store";
import { fmt, fmtInt } from "@/components/erp/ErpUI";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "الشاشة الرئيسية - نظام ERP" },
      { name: "description", content: "لوحة التحكم الرئيسية لنظام إدارة أوامر الشراء" },
      { property: "og:title", content: "الشاشة الرئيسية - نظام ERP" },
      { property: "og:description", content: "لوحة تحكم النظام" },
    ],
  }),
  component: HomePage,
});

const CARDS = [
  {
    to: "/purchase-request",
    label: "طلبات الشراء",
    icon: ClipboardPen,
    color: "text-sky-600",
    bg: "bg-sky-50",
  },
  {
    to: "/purchase-order",
    label: "أوامر الشراء",
    icon: ShoppingCart,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    to: "/suppliers",
    label: "الموردون",
    icon: Building2,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  {
    to: "/items",
    label: "دليل الأصناف",
    icon: Package,
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
  {
    to: "/reports",
    label: "التقارير",
    icon: BarChart3,
    color: "text-indigo-600",
    bg: "bg-indigo-50",
  },
  { to: "/users", label: "المستخدمون", icon: Users, color: "text-rose-600", bg: "bg-rose-50" },
  {
    to: "/settings",
    label: "الإعدادات",
    icon: SettingsIcon,
    color: "text-slate-600",
    bg: "bg-slate-100",
  },
];

function HomePage() {
  const pos = useErpStore((s) => s.purchaseOrders);
  const reqs = useErpStore((s) => s.purchaseRequests);
  const suppliers = useErpStore((s) => s.suppliers);
  const items = useErpStore((s) => s.items);

  // كل أمر يُحتسب مرة واحدة. كان يُحتسب ثلاثاً: مرة في مجموع المشتريات، ومرة في
  // مجموع المصاريف، ومرة ثالثة داخل جدول «آخر أوامر الشراء» — وكل احتساب يمرّ
  // على كل أسطر الأمر ومصروفاته.
  //
  // computePO() totals are always in USD (the system's single reference currency
  // for costing), so summing across orders needs no per-PO conversion here.
  const metrics = useMemo(() => pos.map((p) => computePO(p)), [pos]);
  const totalValue = metrics.reduce((s, m) => s + m.totalPurchase, 0);
  const totalExp = metrics.reduce((s, m) => s + m.totalExpenses, 0);

  return (
    <ErpLayout title="الشاشة الرئيسية">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={ClipboardPen}
          color="text-sky-600"
          label="طلبات الشراء"
          value={fmtInt(reqs.length)}
        />
        <StatCard
          icon={ShoppingCart}
          color="text-blue-600"
          label="أوامر الشراء"
          value={fmtInt(pos.length)}
        />
        <StatCard
          icon={Building2}
          color="text-emerald-600"
          label="الموردون"
          value={fmtInt(suppliers.length)}
        />
        <StatCard
          icon={Package}
          color="text-amber-600"
          label="الأصناف"
          value={fmtInt(items.length)}
        />
        <StatCard
          icon={Wallet}
          color="text-rose-600"
          label="إجمالي المصروفات"
          value={fmt(totalExp)}
          unit="USD"
        />
        <StatCard
          icon={TrendingUp}
          color="text-indigo-600"
          label="إجمالي المشتريات"
          value={fmt(totalValue)}
          unit="USD"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
        {CARDS.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className={`${c.bg} border border-slate-200 rounded-lg p-4 flex flex-col items-center gap-2 hover:shadow-md transition-shadow`}
          >
            <c.icon size={40} className={c.color} strokeWidth={1.4} />
            <div className="text-sm font-semibold text-slate-700">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="bg-white border border-slate-300 rounded mt-4">
        <div
          className="px-3 py-2 border-b border-slate-300 font-semibold text-slate-700"
          style={{ background: "var(--color-erp-panel-header)" }}
        >
          آخر أوامر الشراء
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-700">
              <th className="px-3 py-2 border-b text-right">رقم الفاتورة</th>
              <th className="px-3 py-2 border-b text-right">التاريخ</th>
              <th className="px-3 py-2 border-b text-right">المورد</th>
              <th className="px-3 py-2 border-b text-right">الإجمالي</th>
              <th className="px-3 py-2 border-b text-right">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {pos.slice(0, 5).map((p, i) => {
              const m = metrics[i];
              const sup = suppliers.find((s) => s.code === p.supplierCode);
              return (
                <tr key={p.number} className="hover:bg-blue-50/40">
                  <td className="px-3 py-2 border-b">{p.number}</td>
                  <td className="px-3 py-2 border-b">{p.date}</td>
                  <td className="px-3 py-2 border-b">{sup?.name ?? p.supplierCode}</td>
                  <td className="px-3 py-2 border-b">{fmt(m.totalCost)} USD</td>
                  <td className="px-3 py-2 border-b">
                    {p.approved ? (
                      <span className="text-emerald-600 font-semibold">معتمد</span>
                    ) : (
                      <span className="text-amber-600">مسودة</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ErpLayout>
  );
}

function StatCard({ icon: Icon, color, label, value, unit }: any) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <Icon size={28} className={color} strokeWidth={1.5} />
        <div className="text-right">
          <div className="text-xs text-slate-500">{label}</div>
          <div className="text-xl font-bold text-slate-800">
            {value} {unit && <span className="text-xs">{unit}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
