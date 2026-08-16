import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, X, Users as UsersIcon, ShieldAlert, UserPlus, Trash2, KeyRound, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { useCloseGuard } from "@/components/erp/CloseGuard";
import { ErpTable } from "@/components/erp/ErpUI";
import { useErpStore, hydrateStore } from "@/lib/erp-store";
import { useAuth, signUp, changePassword, approveUser, setAllowSignup } from "@/lib/auth";
import { localDb, logAudit } from "@/lib/local-db";
import type { Role } from "@/lib/erp-types";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "المستخدمون - نظام ERP" },
      { name: "description", content: "إدارة المستخدمين والصلاحيات في النظام" },
      { property: "og:title", content: "المستخدمون - نظام ERP" },
      { property: "og:description", content: "شاشة إدارة المستخدمين والصلاحيات" },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const users = useErpStore((s) => s.users);
  const { role: myRole, user, allowSignup } = useAuth();
  const isAdmin = myRole === "admin";
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [nu, setNu] = useState({ username: "", fullName: "", password: "", role: "user" as Role });
  const [pwUser, setPwUser] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");

  const changeRole = async (userId: string, newRole: Role) => {
    if (!isAdmin) return toast.error("يتطلب صلاحية مدير");
    if (userId === user?.id && newRole !== "admin") return toast.error("لا يمكن إزالة صلاحيتك كمدير");
    setBusy(true);
    try {
      const list = await localDb.users.list();
      const u = list.find((x) => x.id === userId);
      if (!u) throw new Error("المستخدم غير موجود");
      const before = { role: u.role };
      await localDb.users.upsert({ ...u, role: newRole });
      await logAudit({
        user_email: user?.username ?? null,
        action: "UPDATE",
        table_name: "users",
        record_id: userId,
        before_data: before,
        after_data: { role: newRole },
      });
      toast.success("تم تحديث الصلاحية");
      await hydrateStore();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const addUser = async () => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      await signUp({ username: nu.username.trim(), password: nu.password, fullName: nu.fullName, role: nu.role, createdByAdmin: true });
      toast.success("تم إضافة المستخدم");
      setShowAdd(false);
      setNu({ username: "", fullName: "", password: "", role: "user" });
      await hydrateStore();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const approve = async (id: string) => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      await approveUser(id);
      toast.success("تم قبول الطلب");
      await hydrateStore();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const removeUser = async (id: string) => {
    if (!isAdmin) return;
    if (id === user?.id) return toast.error("لا يمكن حذف حسابك الحالي");
    if (!confirm("حذف هذا المستخدم؟")) return;
    setBusy(true);
    try {
      const removed = await localDb.users.remove(id);
      await logAudit({
        user_email: user?.username ?? null,
        action: "DELETE",
        table_name: "users",
        record_id: id,
        before_data: removed ? { username: removed.username, role: removed.role } : null,
        after_data: null,
      });
      toast.success("تم الحذف");
      await hydrateStore();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const toggleSignup = async () => {
    setBusy(true);
    try {
      await setAllowSignup(!allowSignup);
      toast.success(allowSignup ? "تم إغلاق صفحة إنشاء الحسابات" : "تم تفعيل صفحة إنشاء الحسابات");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const resetPassword = async () => {
    if (!pwUser || !newPw) return;
    setBusy(true);
    try {
      await changePassword(pwUser, newPw);
      toast.success("تم تغيير كلمة المرور");
      setPwUser(null); setNewPw("");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  // شاشة عرض: لا بيانات معلّقة تُحفظ، فيكتفي الحارس بسؤال تأكيد قبل الإغلاق.
  const closeGuard = useCloseGuard({ title: "المستخدمين" });

  const actions = [
    ...(isAdmin ? [{ icon: UserPlus, label: "مستخدم جديد", color: "text-emerald-600", onClick: () => setShowAdd(true) }] : []),
    ...(isAdmin
      ? [
          allowSignup
            ? { icon: LockKeyhole, label: "إغلاق صفحة التسجيل", color: "text-rose-600", onClick: toggleSignup, disabled: busy }
            : { icon: LockKeyholeOpen, label: "تفعيل صفحة التسجيل", color: "text-emerald-600", onClick: toggleSignup, disabled: busy },
        ]
      : []),
    { icon: RefreshCw, label: "تحديث", color: "text-blue-600", onClick: () => hydrateStore() },
    { icon: X, label: "إغلاق", hint: "Esc", color: "text-rose-600", onClick: closeGuard.requestClose },
  ];

  return (
    <ErpLayout title="المستخدمون" ribbon={<Ribbon actions={actions} />}>
      {!isAdmin && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded p-2 text-xs flex items-center gap-2">
          <ShieldAlert size={14} /> تعديل الصلاحيات متاح للمديرين فقط
        </div>
      )}
      {isAdmin && (
        <div className={`rounded p-2 text-xs flex items-center gap-2 border ${allowSignup ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
          {allowSignup ? <LockKeyholeOpen size={14} /> : <LockKeyhole size={14} />}
          صفحة إنشاء الحسابات (تسجيل الدخول ← إنشاء حساب) حالياً <b>{allowSignup ? "مفعّلة" : "مغلقة"}</b>
          — يمكن للزوار {allowSignup ? "تقديم طلب حساب جديد" : "تسجيل الدخول فقط، ولا يمكنهم التسجيل الذاتي"}.
        </div>
      )}
      {showAdd && isAdmin && (
        <div className="bg-white border border-slate-300 rounded p-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
          <div><label className="text-xs text-slate-500">اسم المستخدم</label><input value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} className="w-full px-2 py-1 border border-slate-300 rounded text-sm" /></div>
          <div><label className="text-xs text-slate-500">الاسم الكامل</label><input value={nu.fullName} onChange={(e) => setNu({ ...nu, fullName: e.target.value })} className="w-full px-2 py-1 border border-slate-300 rounded text-sm" /></div>
          <div><label className="text-xs text-slate-500">كلمة المرور</label><input type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} className="w-full px-2 py-1 border border-slate-300 rounded text-sm" /></div>
          <div><label className="text-xs text-slate-500">الصلاحية</label>
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as Role })} className="w-full px-2 py-1 border border-slate-300 rounded text-sm">
              <option value="admin">مدير</option><option value="user">مستخدم</option><option value="viewer">مطالع</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={addUser} disabled={busy} className="flex-1 px-2 py-1 bg-emerald-600 text-white rounded text-xs disabled:opacity-50">إضافة</button>
            <button onClick={() => setShowAdd(false)} className="px-2 py-1 bg-slate-200 rounded text-xs">إلغاء</button>
          </div>
        </div>
      )}
      {pwUser && (
        <div className="bg-white border border-slate-300 rounded p-3 flex items-end gap-2">
          <div className="flex-1"><label className="text-xs text-slate-500">كلمة المرور الجديدة</label><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="w-full px-2 py-1 border border-slate-300 rounded text-sm" /></div>
          <button onClick={resetPassword} disabled={busy} className="px-3 py-1 bg-blue-600 text-white rounded text-xs">حفظ</button>
          <button onClick={() => { setPwUser(null); setNewPw(""); }} className="px-3 py-1 bg-slate-200 rounded text-xs">إلغاء</button>
        </div>
      )}
      <div className="bg-white border border-slate-300 rounded">
        <div className="px-3 py-2 border-b border-slate-300 flex items-center gap-2 font-semibold text-slate-700" style={{ background: "var(--color-erp-panel-header)" }}>
          <UsersIcon size={16} /> المستخدمون ({users.length})
        </div>
        <ErpTable headers={["م", "اسم المستخدم", "الاسم", "الصلاحية", "الحالة", "إجراءات"]}>
          {users.map((u, i) => (
            <tr key={u.id}>
              <td className="border border-slate-200 text-center">{i + 1}</td>
              <td className="border border-slate-200 px-2">{u.username}</td>
              <td className="border border-slate-200 px-2 text-right">{u.fullName}</td>
              <td className="border border-slate-200 p-0">
                <select value={u.role} disabled={!isAdmin || busy} onChange={(e) => changeRole(u.id, e.target.value as Role)} className="w-full px-2 py-1 bg-transparent outline-none text-center disabled:cursor-not-allowed disabled:opacity-70">
                  <option value="admin">مدير</option>
                  <option value="user">مستخدم</option>
                  <option value="viewer">مطالع</option>
                </select>
              </td>
              <td className="border border-slate-200 text-center text-xs">
                {u.pending ? (
                  <span className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-800">قيد المراجعة</span>
                ) : (
                  <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">مفعّل</span>
                )}
              </td>
              <td className="border border-slate-200 px-1 text-center">
                {isAdmin && (
                  <div className="flex items-center gap-1 justify-center">
                    {u.pending && (
                      <button onClick={() => approve(u.id)} title="قبول الطلب" className="px-2 py-0.5 text-[11px] bg-emerald-600 text-white rounded hover:bg-emerald-700">قبول</button>
                    )}
                    <button onClick={() => setPwUser(u.id)} title="تغيير كلمة السر" className="p-1 text-blue-600 hover:bg-blue-50 rounded"><KeyRound size={14} /></button>
                    <button onClick={() => removeUser(u.id)} title="حذف" className="p-1 text-rose-600 hover:bg-rose-50 rounded"><Trash2 size={14} /></button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr><td colSpan={6} className="text-center py-8 text-slate-400 text-sm">لا يوجد مستخدمون بعد</td></tr>
          )}
        </ErpTable>
      </div>
      {closeGuard.dialog}
    </ErpLayout>
  );
}
