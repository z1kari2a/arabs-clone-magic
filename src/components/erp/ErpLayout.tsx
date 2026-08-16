import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Circle, Keyboard, LogOut, ShieldCheck, Menu } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useErpStore, useHydrate } from "@/lib/erp-store";
import { appIcon, appName } from "@/lib/branding";
import { useAuth } from "@/lib/auth";
import { QuickSidebar } from "./QuickSidebar";

const TABS = [
  { to: "/home", label: "الرئيسية" },
  { to: "/purchase-request", label: "طلبات الشراء" },
  { to: "/purchase-order", label: "أوامر الشراء" },
  { to: "/price-tiers", label: "التسعيرات" },
  { to: "/suppliers", label: "الموردون" },
  { to: "/items", label: "دليل الأصناف" },
  { to: "/expenses", label: "المصروفات" },
  { to: "/reports", label: "التقارير" },
  { to: "/users", label: "المستخدمون" },
  { to: "/audit-log", label: "سجل التدقيق", adminOnly: true },
  { to: "/settings", label: "الإعدادات" },
] as const;

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
  const settings = useErpStore((s) => s.settings);
  const { session, user, role, fullName, loading, signOut } = useAuth();
  useHydrate();
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString("en-US"));
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date().toLocaleTimeString("en-US")), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!loading && !session) router.navigate({ to: "/" });
  }, [loading, session, router]);

  // يُسأل قبل الخروج. سابقاً كان زر «×» في الشريط المرسوم موصولاً بهذه الدالة —
  // فمن ضغطه ظانّاً أنه يغلق النافذة وجد نفسه خارج حسابه. الزر حُذف، والسؤال
  // يبقى لأن تسجيل الخروج فعلٌ مقصود لا يُنفَّذ بضغطة عابرة.
  const onLogout = async () => {
    if (!confirm("تسجيل الخروج من الحساب؟")) return;
    await signOut();
    router.navigate({ to: "/" });
  };

  const roleLabel =
    role === "admin" ? "مدير" : role === "user" ? "مستخدم" : role === "viewer" ? "مطالع" : "";
  const roleBadgeCls =
    role === "admin" ? "bg-rose-500" : role === "user" ? "bg-blue-500" : "bg-slate-500";

  if (loading || !session) {
    return (
      <div
        dir="rtl"
        className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-500 text-sm"
      >
        جاري التحميل...
      </div>
    );
  }

  return (
    <div
      className="h-screen w-full font-sans text-[13px] text-slate-800 flex flex-col overflow-hidden"
      style={{ background: "var(--color-erp-bg)" }}
      dir="rtl"
    >
      {/* شريط التطبيق — وليس شريط عنوان.
          كان يرسم أزرار تصغير/تكبير/إغلاق تقليداً لويندوز: الأولان بلا onClick
          إطلاقاً (ضغطهما لا يفعل شيئاً)، والثالث موصول بتسجيل الخروج. وفوق ذلك،
          النافذة تُنشأ بإطار ويندوز الأصلي (electron/main.cjs: لا frame:false)
          فكان يظهر شريطا عنوان فوق بعضهما. الأزرار الثلاثة حُذفت: النافذة لها
          أزرارها الحقيقية من ويندوز، وهذا الشريط يحمل ما لا يحمله ذاك — هوية
          البرنامج، واسم الشاشة، ومفتاح القائمة الجانبية، والخروج من الحساب. */}
      <div
        className="relative flex items-center justify-between px-3 h-9 text-white shrink-0"
        style={{ background: "var(--color-erp-titlebar)" }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "إخفاء القائمة الجانبية" : "إظهار القائمة الجانبية"}
            className="w-7 h-7 rounded hover:bg-white/15 flex items-center justify-center transition-colors"
            aria-label={sidebarOpen ? "إخفاء القائمة الجانبية" : "إظهار القائمة الجانبية"}
          >
            <Menu size={16} />
          </button>
          <img
            src={appIcon(settings)}
            alt=""
            className="w-6 h-6 rounded object-contain bg-white/10"
          />
          <span className="text-sm font-semibold">{appName(settings)}</span>
          <span className="text-[11px] opacity-75 hidden sm:inline">{settings.companyName}</span>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold">{title}</div>
        <div className="flex items-center gap-1">
          <button
            onClick={onLogout}
            title="تسجيل الخروج من الحساب"
            className="px-2.5 h-7 rounded hover:bg-white/15 flex items-center gap-1.5 text-[11px] transition-colors"
          >
            <LogOut size={12} /> خروج
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-row overflow-hidden">
        {sidebarOpen && <QuickSidebar onClose={() => setSidebarOpen(false)} />}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Tabs */}
          <div className="flex items-end bg-gradient-to-b from-slate-100 to-slate-200 border-b border-slate-300 px-1 pt-1 shrink-0">
            <button className="px-4 py-1.5 text-[13px] bg-slate-100 border border-transparent hover:bg-white/70 text-slate-700 rounded-t-md ml-1">
              ملف
            </button>
            {TABS.filter((t) => !(t as any).adminOnly || role === "admin").map((t) => {
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
            <button className="px-4 py-1.5 text-[13px] bg-slate-100 border border-transparent hover:bg-white/70 text-slate-700 rounded-t-md ml-1">
              المساعدة
            </button>
          </div>

          {/* Ribbon */}
          {ribbon && (
            <div className="bg-gradient-to-b from-white to-slate-50 border-b border-slate-300 px-2 py-1 flex items-stretch gap-0.5 overflow-x-auto shadow-[0_1px_0_rgba(0,0,0,0.03)] shrink-0">
              {ribbon}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-auto">
            <div className="mx-auto max-w-[1600px] p-3 space-y-2">{children}</div>
          </div>

          {/* Status bar */}
          <div
            className="flex items-center justify-between px-3 py-1 text-white text-[11px] border-t border-black/10 shrink-0"
            style={{ background: "var(--color-erp-status)" }}
          >
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                المستخدم: {fullName || user?.username}
              </span>
              {role && (
                <span
                  className={`px-1.5 py-0.5 rounded text-white ${roleBadgeCls} flex items-center gap-1`}
                >
                  <ShieldCheck size={10} /> {roleLabel}
                </span>
              )}
              <span>الفترة المالية: {settings.fiscalYear}</span>
              <span className="hidden md:flex items-center gap-1 opacity-90">
                <Keyboard size={12} /> Ctrl+N جديد • Ctrl+S حفظ • F2 تعديل • F3 بحث • F9 اعتماد •
                Esc إغلاق
              </span>
            </div>
            <div className="flex items-center gap-4">
              {/* The old label said "متصل" unconditionally — a connection
                  indicator that never checked anything, in a program whose
                  whole point is that it needs no connection. */}
              <span className="flex items-center gap-1" title="كل البيانات محفوظة على هذا الجهاز">
                <Circle size={8} className="fill-emerald-400 text-emerald-400" /> قاعدة بيانات محلية
              </span>
              <span className="tabular-nums">{clock}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
