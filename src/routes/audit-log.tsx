import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw, X, ScrollText, ShieldAlert } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { useCloseGuard } from "@/components/erp/CloseGuard";
import { ErpTable } from "@/components/erp/ErpUI";
import { useAuth } from "@/lib/auth";
import { getAudit } from "@/lib/local-db";
import type { AuditEntry } from "@/lib/erp-types";

export const Route = createFileRoute("/audit-log")({
  head: () => ({
    meta: [
      { title: "سجل التدقيق - نظام ERP" },
      { name: "description", content: "سجل تفصيلي لكل العمليات في النظام" },
      { property: "og:title", content: "سجل التدقيق - نظام ERP" },
      { property: "og:description", content: "سجل تفصيلي لكل التغييرات مع القيم قبل وبعد" },
    ],
  }),
  component: AuditPage,
});

const ACTION_COLORS: Record<string, string> = {
  INSERT: "bg-emerald-100 text-emerald-700",
  UPDATE: "bg-blue-100 text-blue-700",
  DELETE: "bg-rose-100 text-rose-700",
};

function AuditPage() {
  const { role } = useAuth();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const rows = await getAudit();
    setRows(rows);
    setLoading(false);
  };

  useEffect(() => {
    if (role === "admin") void load();
    else setLoading(false);
  }, [role]);

  // شاشة عرض: لا بيانات معلّقة تُحفظ، فيكتفي الحارس بسؤال تأكيد قبل الإغلاق.
  // يُستدعى قبل أي `return` مبكر — قواعد الخطّافات لا تسمح باستدعاء مشروط.
  const closeGuard = useCloseGuard({ title: "سجل التدقيق" });

  if (role !== "admin") {
    return (
      <ErpLayout title="سجل التدقيق">
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded p-4 flex items-center gap-2">
          <ShieldAlert size={18} /> هذه الصفحة متاحة للمديرين فقط
        </div>
      </ErpLayout>
    );
  }

  const filtered = rows.filter(
    (r) =>
      !filter ||
      r.table_name.includes(filter) ||
      r.action.includes(filter) ||
      (r.user_email ?? "").includes(filter),
  );

  const actions = [
    { icon: RefreshCw, label: "تحديث", color: "text-blue-600", onClick: load },
    {
      icon: X,
      label: "إغلاق",
      hint: "Esc",
      color: "text-rose-600",
      onClick: closeGuard.requestClose,
    },
  ];

  return (
    <ErpLayout title="سجل التدقيق" ribbon={<Ribbon actions={actions} />}>
      <div className="bg-white border border-slate-300 rounded">
        <div
          className="px-3 py-2 border-b border-slate-300 flex items-center justify-between gap-2 font-semibold text-slate-700"
          style={{ background: "var(--color-erp-panel-header)" }}
        >
          <div className="flex items-center gap-2">
            <ScrollText size={16} /> سجل التدقيق ({filtered.length})
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="فلترة بالجدول / المستخدم / النوع"
            className="text-xs px-2 py-1 border border-slate-300 rounded w-64 font-normal"
          />
        </div>
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <ErpTable
            headers={["م", "التاريخ", "المستخدم", "العملية", "الجدول", "المعرّف", "التفاصيل"]}
          >
            {loading && (
              <tr>
                <td colSpan={7} className="text-center py-6 text-slate-400 text-sm">
                  جاري التحميل...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-6 text-slate-400 text-sm">
                  لا توجد سجلات
                </td>
              </tr>
            )}
            {filtered.map((r, i) => (
              <>
                <tr key={r.id} className={expanded === r.id ? "bg-blue-50" : ""}>
                  <td className="border border-slate-200 text-center text-[11px]">{i + 1}</td>
                  <td className="border border-slate-200 px-2 text-[11px] tabular-nums whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("en-GB")}
                  </td>
                  <td className="border border-slate-200 px-2 text-[11px]">
                    {r.user_email ?? "-"}
                  </td>
                  <td className="border border-slate-200 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${ACTION_COLORS[r.action] ?? "bg-slate-100"}`}
                    >
                      {r.action}
                    </span>
                  </td>
                  <td className="border border-slate-200 px-2 text-[11px] font-mono">
                    {r.table_name}
                  </td>
                  <td className="border border-slate-200 px-2 text-[10px] font-mono text-slate-500">
                    {r.record_id?.slice(0, 8) ?? "-"}
                  </td>
                  <td className="border border-slate-200 text-center">
                    <button
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      className="text-blue-600 text-[11px] hover:underline"
                    >
                      {expanded === r.id ? "إخفاء" : "عرض"}
                    </button>
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr key={`${r.id}-detail`}>
                    <td colSpan={7} className="border border-slate-200 bg-slate-50 p-3">
                      <div className="grid grid-cols-2 gap-3 text-[11px]">
                        <div>
                          <div className="font-semibold text-rose-700 mb-1">قبل التعديل</div>
                          <pre
                            className="bg-white border border-slate-200 p-2 rounded overflow-auto max-h-48"
                            dir="ltr"
                          >
                            {r.before_data ? JSON.stringify(r.before_data, null, 2) : "—"}
                          </pre>
                        </div>
                        <div>
                          <div className="font-semibold text-emerald-700 mb-1">بعد التعديل</div>
                          <pre
                            className="bg-white border border-slate-200 p-2 rounded overflow-auto max-h-48"
                            dir="ltr"
                          >
                            {r.after_data ? JSON.stringify(r.after_data, null, 2) : "—"}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </ErpTable>
        </div>
      </div>
      {closeGuard.dialog}
    </ErpLayout>
  );
}
