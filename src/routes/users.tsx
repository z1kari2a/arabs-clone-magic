import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer, FileSpreadsheet, Download, CheckCircle2, X, Users as UsersIcon } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { ErpTable, Cell } from "@/components/erp/ErpUI";
import { erpStore, useErpStore } from "@/lib/erp-store";
import type { User } from "@/lib/erp-types";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "المستخدمون - نظام ERP" },
      { name: "description", content: "إدارة المستخدمين والصلاحيات" },
      { property: "og:title", content: "المستخدمون - نظام ERP" },
      { property: "og:description", content: "شاشة إدارة المستخدمين" },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const users = useErpStore((s) => s.users);
  const [list, setList] = useState<User[]>(users);
  const [editing, setEditing] = useState(false);

  const patch = (i: number, p: Partial<User>) => setList(list.map((u, idx) => (idx === i ? { ...u, ...p } : u)));
  const onNew = () => { setList([...list, { username: `user${list.length + 1}`, fullName: "", role: "user", active: true }]); setEditing(true); };
  const onSave = () => { erpStore.set({ users: list }); setEditing(false); toast.success("تم الحفظ"); };
  const noop = () => {};

  const actions = [
    { icon: FilePlus2, label: "جديد", color: "text-emerald-600", onClick: onNew },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: noop },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: onSave },
    { icon: Pencil, label: "تعديل", color: "text-cyan-600", onClick: () => setEditing(true) },
    { icon: Trash2, label: "حذف", color: "text-rose-600", onClick: noop },
    { icon: Search, label: "بحث", color: "text-indigo-500", onClick: noop },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: () => window.print() },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: noop },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: noop },
    { icon: CheckCircle2, label: "اعتماد", color: "text-emerald-700", onClick: onSave },
    { icon: X, label: "إغلاق", color: "text-rose-600", onClick: () => history.back() },
  ];

  return (
    <ErpLayout title="المستخدمون" ribbon={<Ribbon actions={actions} />}>
      <div className="bg-white border border-slate-300 rounded">
        <div className="px-3 py-2 border-b border-slate-300 flex items-center gap-2 font-semibold text-slate-700" style={{ background: "var(--color-erp-panel-header)" }}>
          <UsersIcon size={16} /> المستخدمون ({list.length})
        </div>
        <ErpTable headers={["م","اسم المستخدم","الاسم الكامل","الصلاحية","الحالة"]}>
          {list.map((u, i) => (
            <tr key={u.username + i}>
              <td className="border border-slate-200 text-center">{i + 1}</td>
              <Cell value={u.username} onChange={(v) => patch(i, { username: v })} disabled={!editing} />
              <Cell value={u.fullName} onChange={(v) => patch(i, { fullName: v })} disabled={!editing} align="right" />
              <td className="border border-slate-200 p-0">
                <select value={u.role} disabled={!editing} onChange={(e) => patch(i, { role: e.target.value as User["role"] })} className="w-full px-2 py-1 bg-transparent outline-none text-center">
                  <option value="admin">مدير</option>
                  <option value="user">مستخدم</option>
                  <option value="viewer">مطالع</option>
                </select>
              </td>
              <td className="border border-slate-200 text-center">
                <button disabled={!editing} onClick={() => patch(i, { active: !u.active })} className={`px-2 py-0.5 rounded text-xs ${u.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"} disabled:opacity-70`}>
                  {u.active ? "نشط" : "موقوف"}
                </button>
              </td>
            </tr>
          ))}
        </ErpTable>
      </div>
    </ErpLayout>
  );
}