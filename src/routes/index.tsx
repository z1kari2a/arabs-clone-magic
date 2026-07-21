import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { LogIn, User, Lock } from "lucide-react";
import { toast } from "sonner";
import { erpStore, useErpStore } from "@/lib/erp-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول - نظام ERP" },
      { name: "description", content: "تسجيل الدخول إلى نظام إدارة أوامر الشراء" },
      { property: "og:title", content: "تسجيل الدخول - نظام ERP" },
      { property: "og:description", content: "شاشة تسجيل الدخول" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const users = useErpStore((s) => s.users);
  const company = useErpStore((s) => s.settings.companyName);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");

  const login = (e: React.FormEvent) => {
    e.preventDefault();
    const u = users.find((x) => x.username === username && x.active);
    if (!u) return toast.error("المستخدم غير موجود أو موقوف");
    if (password.length < 3) return toast.error("كلمة المرور قصيرة");
    erpStore.set({ session: { username: u.username } });
    toast.success(`مرحباً ${u.fullName}`);
    router.navigate({ to: "/home" });
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen font-sans flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, #1e5a8e 0%, #2d7fc4 100%)" }}
    >
      <div className="w-full max-w-sm bg-white rounded-lg shadow-2xl overflow-hidden">
        <div className="p-6 text-white text-center" style={{ background: "var(--color-erp-titlebar)" }}>
          <div className="w-14 h-14 mx-auto rounded-lg bg-white/20 flex items-center justify-center font-bold text-xl mb-2">ERP</div>
          <h1 className="text-lg font-bold">{company}</h1>
          <p className="text-xs opacity-80 mt-1">نظام تخطيط موارد المؤسسات</p>
        </div>
        <form onSubmit={login} className="p-6 space-y-4">
          <h2 className="text-center font-semibold text-slate-700">تسجيل الدخول</h2>
          <div className="space-y-1">
            <label className="text-xs text-slate-600">اسم المستخدم</label>
            <div className="flex border border-slate-300 rounded overflow-hidden focus-within:ring-1 focus-within:ring-blue-400">
              <div className="px-3 flex items-center bg-slate-50 border-l border-slate-300"><User size={14} className="text-slate-500" /></div>
              <input value={username} onChange={(e) => setUsername(e.target.value)} className="flex-1 px-2 py-2 text-sm outline-none text-right" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-600">كلمة المرور</label>
            <div className="flex border border-slate-300 rounded overflow-hidden focus-within:ring-1 focus-within:ring-blue-400">
              <div className="px-3 flex items-center bg-slate-50 border-l border-slate-300"><Lock size={14} className="text-slate-500" /></div>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="flex-1 px-2 py-2 text-sm outline-none text-right" />
            </div>
          </div>
          <button type="submit" className="w-full py-2 rounded text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90" style={{ background: "var(--color-erp-titlebar)" }}>
            <LogIn size={16} /> دخول
          </button>
          <p className="text-[11px] text-center text-slate-500">افتراضي: admin / admin</p>
        </form>
      </div>
    </div>
  );
}
