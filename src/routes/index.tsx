import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogIn, Mail, Lock, User as UserIcon, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { hydrateStore } from "@/lib/erp-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول - نظام ERP" },
      { name: "description", content: "تسجيل الدخول إلى نظام إدارة أوامر الشراء" },
      { property: "og:title", content: "تسجيل الدخول - نظام ERP" },
      { property: "og:description", content: "شاشة تسجيل الدخول لنظام ERP" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const { session } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) {
      void hydrateStore().then(() => router.navigate({ to: "/home" }));
    }
  }, [session, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("مرحباً بعودتك");
      } else {
        if (password.length < 6) throw new Error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName || email.split("@")[0] }, emailRedirectTo: `${window.location.origin}/home` },
        });
        if (error) throw error;
        toast.success("تم إنشاء الحساب — يتم تسجيل الدخول تلقائياً");
      }
    } catch (err: any) {
      toast.error(err.message || "فشل");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen font-sans flex items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, #1e5a8e 0%, #2d7fc4 100%)" }}>
      <div className="w-full max-w-sm bg-white rounded-lg shadow-2xl overflow-hidden">
        <div className="p-6 text-white text-center" style={{ background: "var(--color-erp-titlebar)" }}>
          <div className="w-14 h-14 mx-auto rounded-lg bg-white/20 flex items-center justify-center font-bold text-xl mb-2">ERP</div>
          <h1 className="text-lg font-bold">نظام تخطيط موارد المؤسسات</h1>
          <p className="text-xs opacity-80 mt-1">إدارة المشتريات والمخزون</p>
        </div>
        <div className="flex border-b border-slate-200">
          <button onClick={() => setMode("login")} className={`flex-1 py-2 text-sm font-medium ${mode === "login" ? "bg-white text-blue-700 border-b-2 border-blue-600" : "bg-slate-50 text-slate-500"}`}>تسجيل الدخول</button>
          <button onClick={() => setMode("signup")} className={`flex-1 py-2 text-sm font-medium ${mode === "signup" ? "bg-white text-blue-700 border-b-2 border-blue-600" : "bg-slate-50 text-slate-500"}`}>إنشاء حساب</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-3">
          {mode === "signup" && (
            <div className="space-y-1">
              <label className="text-xs text-slate-600">الاسم الكامل</label>
              <div className="flex border border-slate-300 rounded overflow-hidden focus-within:ring-1 focus-within:ring-blue-400">
                <div className="px-3 flex items-center bg-slate-50 border-l border-slate-300"><UserIcon size={14} className="text-slate-500" /></div>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="flex-1 px-2 py-2 text-sm outline-none text-right" placeholder="اسمك" />
              </div>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-slate-600">البريد الإلكتروني</label>
            <div className="flex border border-slate-300 rounded overflow-hidden focus-within:ring-1 focus-within:ring-blue-400">
              <div className="px-3 flex items-center bg-slate-50 border-l border-slate-300"><Mail size={14} className="text-slate-500" /></div>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1 px-2 py-2 text-sm outline-none" placeholder="you@example.com" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-600">كلمة المرور</label>
            <div className="flex border border-slate-300 rounded overflow-hidden focus-within:ring-1 focus-within:ring-blue-400">
              <div className="px-3 flex items-center bg-slate-50 border-l border-slate-300"><Lock size={14} className="text-slate-500" /></div>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="flex-1 px-2 py-2 text-sm outline-none" placeholder="••••••" />
            </div>
          </div>
          <button type="submit" disabled={busy} className="w-full py-2 rounded text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50" style={{ background: "var(--color-erp-titlebar)" }}>
            {mode === "login" ? <><LogIn size={16} /> دخول</> : <><UserPlus size={16} /> إنشاء الحساب</>}
          </button>
          <p className="text-[11px] text-center text-slate-500">
            {mode === "signup" ? "أول مستخدم يُسجَّل يحصل تلقائياً على صلاحية المدير" : "بيانات محمية عبر Supabase Auth"}
          </p>
        </form>
      </div>
    </div>
  );
}
