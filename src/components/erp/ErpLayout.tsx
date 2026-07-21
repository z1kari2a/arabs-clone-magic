import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Minus, Square, X, Circle } from "lucide-react";
import type { ReactNode } from "react";
import { useErpStore, erpStore } from "@/lib/erp-store";

const TABS = [
  { to: "/home", label: "الرئيسية" },
  { to: "/purchase-order", label: "أوامر الشراء" },
  { to: "/suppliers", label: "الموردون" },
  { to: "/items", label: "دليل الأصناف" },
  { to: "/reports", label: "التقارير" },
  { to: "/users", label: "المستخدمون" },
  { to: "/settings", label: "الإعدادات" },
];

export default function ErpLayout({
  title,
  ribbon,
  children,
}: {
  title: string;
  ribbon?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const session = useErpStore((s) => s.session);
  const settings = useErpStore((s) => s.settings);

  const onLogout = () => {
    erpStore.set({ session: null });
    router.navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen font-sans text-[13px] text-slate-800 flex flex-col" style={{ background: "var(--color-erp-bg)" }} dir="rtl">
      {/* Title bar */}
      <div className="relative flex items-center justify-between px-3 h-9 text-white" style={{ background: "var(--color-erp-titlebar)" }}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-white/20 flex items-center justify-center text-[10px] font-bold">ERP</div>
          <span className="text-sm font-semibold">{settings.companyName}</span>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold">{title}</div>
        <div className="flex items-center gap-1">
          <button className="w-8 h-7 hover:bg-white/10 flex items-center justify-center"><Minus size={14} /></button>
          <button className="w-8 h-7 hover:bg-white/10 flex items-center justify-center"><Square size={12} /></button>
          <button onClick={onLogout} className="w-8 h-7 hover:bg-rose-600 flex items-center justify-center"><X size={14} /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-end bg-gradient-to-b from-slate-100 to-slate-200 border-b border-slate-300 px-1 pt-1">
        <button className="px-4 py-1.5 text-[13px] bg-slate-100 border border-transparent hover:bg-white/70 text-slate-700 rounded-t-md ml-1">ملف</button>
        {TABS.map((t) => {
          const active = pathname.startsWith(t.to);
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`px-4 py-1.5 text-[13px] border border-b-0 rounded-t-md ml-1 ${
                active
                  ? "bg-white border-slate-300 font-semibold text-blue-700"
                  : "bg-slate-100 border-transparent hover:bg-white/70 text-slate-700"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
        <button className="px-4 py-1.5 text-[13px] bg-slate-100 border border-transparent hover:bg-white/70 text-slate-700 rounded-t-md ml-1">المساعدة</button>
      </div>

      {/* Ribbon */}
      {ribbon && (
        <div className="bg-white border-b border-slate-300 px-2 py-1.5 flex items-stretch gap-0.5 overflow-x-auto">
          {ribbon}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 p-2 space-y-2 overflow-auto">{children}</div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 text-white text-xs" style={{ background: "var(--color-erp-status)" }}>
        <div className="flex items-center gap-4">
          <span>المستخدم: {session?.username ?? "guest"}</span>
          <span>الفترة المالية: {settings.fiscalYear}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Circle size={8} className="fill-emerald-400 text-emerald-400" /> متصل</span>
          <span>{new Date().toLocaleTimeString("en-US")}</span>
        </div>
      </div>
    </div>
  );
}