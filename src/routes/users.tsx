import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, X, Users as UsersIcon, ShieldAlert } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { ErpTable } from "@/components/erp/ErpUI";
import { useErpStore, hydrateStore } from "@/lib/erp-store";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
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
  const { role: myRole, user } = useAuth();
  const isAdmin = myRole === "admin";
  const [busy, setBusy] = useState(false);

  const changeRole = async (userId: string, newRole: Role) => {
    if (!isAdmin) return toast.error("يتطلب صلاحية مدير");
    if (userId === user?.id && newRole !== "admin") return toast.error("لا يمكن إزالة صلاحيتك كمدير");
    setBusy(true);
    try {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
      if (error) throw error;
      toast.success("تم تحديث الصلاحية");
      await hydrateStore();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const actions = [
    { icon: RefreshCw, label: "تحديث", color: "text-blue-600", onClick: () => hydrateStore() },
    { icon: X, label: "إغلاق", color: "text-rose-600", onClick: () => history.back() },
  ];

  return (
    <ErpLayout title="المستخدمون" ribbon={<Ribbon actions={actions} />}>
      {!isAdmin && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded p-2 text-xs flex items-center gap-2">
          <ShieldAlert size={14} /> تعديل الصلاحيات متاح للمديرين فقط
        </div>
      )}
      <div className="bg-white border border-slate-300 rounded">
        <div className="px-3 py-2 border-b border-slate-300 flex items-center gap-2 font-semibold text-slate-700" style={{ background: "var(--color-erp-panel-header)" }}>
          <UsersIcon size={16} /> المستخدمون ({users.length})
        </div>
        <ErpTable headers={["م", "البريد الإلكتروني", "الاسم", "الصلاحية", "المعرّف"]}>
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
              <td className="border border-slate-200 px-2 text-[10px] text-slate-500 font-mono">{u.id.slice(0, 8)}...</td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-sm">لا يوجد مستخدمون بعد</td></tr>
          )}
        </ErpTable>
      </div>
    </ErpLayout>
  );
}
