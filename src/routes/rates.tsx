import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save, RefreshCw, Plus, Trash2, Star, DollarSign, Info, X } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { useCloseGuard } from "@/components/erp/CloseGuard";
import { Panel, fmt, parseDecimal, useNumericBuffer } from "@/components/erp/ErpUI";
import { erpStore, useErpStore } from "@/lib/erp-store";
import { useAuth, canWrite } from "@/lib/auth";
import type { Currency } from "@/lib/erp-types";

export const Route = createFileRoute("/rates")({
  head: () => ({
    meta: [
      { title: "أسعار الصرف - نظام ERP" },
      { name: "description", content: "أسعار الصرف الحالية المعتمدة في النظام" },
      { property: "og:title", content: "أسعار الصرف - نظام ERP" },
      { property: "og:description", content: "إدارة أسعار صرف العملات" },
    ],
  }),
  component: RatesPage,
});

function RatesPage() {
  const settings = useErpStore((s) => s.settings);
  const [rows, setRows] = useState<Currency[]>(settings.currencies ?? []);
  const [defCode, setDefCode] = useState<string>(settings.defaultCurrency || "");
  const [nc, setNc] = useState<{ code: string; name: string; rate: number }>({ code: "", name: "", rate: 0 });
  // Exchange rates feed every cost calculation in the system — viewers may look,
  // not edit.
  const { role } = useAuth();
  const mayWrite = canWrite(role);

  useEffect(() => {
    setRows(settings.currencies ?? []);
    setDefCode(settings.defaultCurrency || settings.currencies?.[0]?.code || "");
  }, [settings.currencies, settings.defaultCurrency]);

  const dirty =
    JSON.stringify(rows) !== JSON.stringify(settings.currencies ?? []) ||
    defCode !== (settings.defaultCurrency || "");
  // USD is the system's accounting base: every amount anywhere converts to USD
  // via `amount / rate`. Its own rate is 1 by definition, and it must always
  // exist — a missing or non-1 USD row silently corrupts every screen's totals.
  const BASE_CODE = "USD";

  const patch = (code: string, p: Partial<Currency>) => {
    if (!mayWrite) return;
    setRows(rows.map((r) => (r.code === code ? { ...r, ...p } : r)));
  };

  const add = () => {
    if (!mayWrite) return toast.error("تعديل أسعار الصرف يتطلب صلاحية مستخدم أو مدير");
    const code = nc.code.trim().toUpperCase();
    if (!code) return toast.error("أدخل رمز العملة");
    if (!nc.name.trim()) return toast.error("أدخل اسم العملة");
    if (rows.some((r) => r.code === code)) return toast.error("العملة موجودة مسبقاً");
    if (code !== BASE_CODE && !(nc.rate > 0)) {
      return toast.error("سعر الصرف يجب أن يكون أكبر من صفر");
    }
    setRows([...rows, { code, name: nc.name.trim(), rate: code === BASE_CODE ? 1 : nc.rate }]);
    setNc({ code: "", name: "", rate: 0 });
  };

  const remove = (code: string) => {
    if (!mayWrite) return toast.error("تعديل أسعار الصرف يتطلب صلاحية مستخدم أو مدير");
    if (code === BASE_CODE) return toast.error(`لا يمكن حذف ${BASE_CODE} — هي العملة الأساسية للنظام`);
    if (rows.length <= 1) return toast.error("يجب الإبقاء على عملة واحدة على الأقل");
    if (code === defCode) return toast.error("لا يمكن حذف العملة الافتراضية");
    setRows(rows.filter((r) => r.code !== code));
  };

  // يُعيد true/false ليعرف حارس الإغلاق هل نجح الحفظ فيُغلق الشاشة — تحقّق مرفوض
  // يعني أن الشاشة تبقى مفتوحة بدل أن تُغلق وتضيع التعديلات.
  const save = (): boolean => {
    if (!mayWrite) { toast.error("تعديل أسعار الصرف يتطلب صلاحية مستخدم أو مدير"); return false; }
    const codes = new Set<string>();
    for (const r of rows) {
      if (!r.code) { toast.error("يوجد عملة بدون رمز"); return false; }
      if (codes.has(r.code)) { toast.error(`رمز مكرر: ${r.code}`); return false; }
      codes.add(r.code);
      // A zero/negative rate makes `amount / rate` return 0 everywhere instead
      // of erroring — the whole invoice silently prices at nothing. Reject it here.
      if (!(r.rate > 0)) { toast.error(`سعر صرف غير صالح للعملة ${r.code} — يجب أن يكون أكبر من صفر`); return false; }
      if (r.code === BASE_CODE && r.rate !== 1) {
        toast.error(`سعر صرف ${BASE_CODE} يجب أن يبقى 1 — هي العملة الأساسية للنظام`);
        return false;
      }
    }
    if (!codes.has(BASE_CODE)) { toast.error(`قائمة العملات يجب أن تحتوي ${BASE_CODE} — هي العملة الأساسية للنظام`); return false; }
    if (!codes.has(defCode)) { toast.error("اختر عملة افتراضية موجودة في القائمة"); return false; }
    erpStore.set({ settings: { ...settings, currencies: rows, defaultCurrency: defCode } });
    // المستندات تحمل سعر صرفها مثبَّتاً عليها، فحفظ الجدول هنا لا يحرّك رقماً في
    // مستند قائم — وهذا مقصود. لكن مستنداً قيد التحرير يجب أن يستطيع اللحاق،
    // فنقول للمستخدم أين الزر بدل أن يظنّ أن التعديل لم يُحفظ.
    toast.success(
      "تم حفظ الأسعار — المستندات المحفوظة لا تتأثر (السعر مثبّت على كل مستند). " +
        "لتطبيقها على أمر/طلب شراء مفتوح: زر «تحديث الأسعار» بجانب حقل سعر الصرف فيه.",
    );
    return true;
  };

  const reset = () => {
    setRows(settings.currencies ?? []);
    setDefCode(settings.defaultCurrency || "");
  };

  // حارس الإغلاق. هذه الشاشة كانت الوحيدة التي تحتفظ بتعديلات غير محفوظة (المؤشر
  // «● يوجد تعديلات لم تُحفظ» أسفلها) وليس فيها زر «إغلاق» أصلاً — فالخروج منها
  // عبر التبويبات كان يضيّع التعديلات بلا سؤال. الأسعار تغذّي كل حساب في النظام،
  // فضياع تعديل هنا ليس تفصيلاً.
  const closeGuard = useCloseGuard({
    dirty: dirty && mayWrite,
    title: "أسعار الصرف",
    onSave: mayWrite ? save : undefined,
    onDiscard: reset,
  });

  const actions = [
    { icon: Save, label: "حفظ", hint: "Ctrl+S", color: "text-blue-600", onClick: save, disabled: !mayWrite },
    { icon: RefreshCw, label: "استرجاع", color: "text-slate-600", onClick: reset, disabled: !dirty },
    { icon: X, label: "إغلاق", hint: "Esc", color: "text-rose-600", onClick: closeGuard.requestClose },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      else if (e.key === "Escape") {
        if (closeGuard.pending) return; // نافذة السؤال نفسها تُغلق بـ Esc
        closeGuard.requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, defCode, closeGuard.pending]);

  return (
    <ErpLayout title="أسعار الصرف" ribbon={<Ribbon actions={actions} />}>
      <Panel
        title={<span className="flex items-center gap-2"><DollarSign size={14} className="text-emerald-600" /> أسعار الصرف الحالية</span>}
      >
        <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded flex items-start gap-2 text-[12px] text-amber-800">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            العملة الأساسية للنظام: <b>USD</b>. كل قيمة تُدخل بأي عملة تُحوّل داخلياً إلى الدولار عبر المعادلة:
            <b> المبلغ ÷ سعر الصرف = المبلغ بالدولار</b>. الأسعار هنا للمستندات الجديدة فقط —
            كل فاتورة/أمر شراء/مصروف يخزّن سعر صرفه لحظة الحفظ فلا تتأثر حساباته لاحقاً.
          </span>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-200">
            <thead className="bg-slate-100 text-[12px] text-slate-600">
              <tr>
                <th className="border border-slate-200 w-10 py-1.5">م</th>
                <th className="border border-slate-200 py-1.5 w-20">افتراضي</th>
                <th className="border border-slate-200 py-1.5 w-28">الرمز</th>
                <th className="border border-slate-200 py-1.5">اسم العملة</th>
                <th className="border border-slate-200 py-1.5 w-44">
                  سعر الصرف <span dir="ltr" className="inline-block">(1 USD =)</span>
                </th>
                <th className="border border-slate-200 py-1.5 w-44">
                  مثال: <span dir="ltr" className="inline-block">100 {'{'}العملة{'}'} → USD</span>
                </th>
                <th className="border border-slate-200 py-1.5 w-16">حذف</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const isBase = c.code === BASE_CODE;
                return (
                <tr key={c.code + i} className={isBase ? "bg-emerald-50/50" : "odd:bg-white even:bg-slate-50/50"}>
                  <td className="border border-slate-200 text-center text-slate-500">{i + 1}</td>
                  <td className="border border-slate-200 text-center">
                    <button
                      onClick={() => setDefCode(c.code)}
                      title="تعيين كافتراضية"
                      className={c.code === defCode ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}
                    >
                      <Star size={16} className={c.code === defCode ? "fill-amber-400" : ""} />
                    </button>
                  </td>
                  <td className="border border-slate-200 p-1">
                    <input
                      value={c.code}
                      readOnly={isBase || !mayWrite}
                      title={isBase ? `${BASE_CODE} هي العملة الأساسية للنظام ولا يمكن تغيير رمزها` : undefined}
                      onChange={(e) => patch(c.code, { code: e.target.value.toUpperCase() })}
                      className={`w-full px-2 py-1 text-center font-semibold bg-transparent rounded focus:outline-none ${isBase ? "text-emerald-800 cursor-not-allowed" : "/50"}`}
                    />
                  </td>
                  <td className="border border-slate-200 p-1">
                    <input
                      value={c.name}
                      onChange={(e) => patch(c.code, { name: e.target.value })}
                      className="w-full px-2 py-1 text-right bg-transparent focus:outline-none/50 rounded"
                    />
                  </td>
                  <td className="border border-slate-200 p-1">
                    {isBase ? (
                      <div
                        title={`سعر ${BASE_CODE} ثابت عند 1 — كل العملات تُقاس مقابله`}
                        className="w-full px-2 py-1 text-right tabular-nums text-emerald-800 font-semibold cursor-not-allowed"
                      >
                        1.0
                      </div>
                    ) : (
                      <RateInput
                        value={c.rate}
                        onChange={(n) => patch(c.code, { rate: n })}
                        className="w-full px-2 py-1 text-right tabular-nums bg-amber-50/40 focus:outline-none focus:bg-amber-50 rounded border border-transparent focus:border-amber-300"
                      />
                    )}
                  </td>
                  <td className="border border-slate-200 text-center text-slate-600 tabular-nums text-xs">
                    <span dir="ltr" className="inline-block">
                      {isBase ? `100 USD = 100.00 USD` : `100 ${c.code} = ${fmt(c.rate ? 100 / c.rate : 0)} USD`}
                    </span>
                  </td>
                  <td className="border border-slate-200 text-center">
                    <button
                      onClick={() => remove(c.code)}
                      disabled={isBase || !mayWrite}
                      title={isBase ? `لا يمكن حذف ${BASE_CODE}` : "حذف"}
                      className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end p-3 bg-slate-50 border border-slate-200 rounded">
          <div>
            <label className="text-[11px] text-slate-600 block mb-1">الرمز</label>
            <input
              value={nc.code}
              onChange={(e) => setNc({ ...nc, code: e.target.value.toUpperCase() })}
              placeholder="USD"
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-center font-semibold"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-600 block mb-1">اسم العملة</label>
            <input
              value={nc.name}
              onChange={(e) => setNc({ ...nc, name: e.target.value })}
              placeholder="دولار"
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-right"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-600 block mb-1">سعر التحويل</label>
            <RateInput
              value={nc.rate}
              onChange={(n) => setNc({ ...nc, rate: n })}
              className="w-full px-2 py-1.5 border border-slate-300 rounded text-right tabular-nums"
            />
          </div>
          <button
            onClick={add}
            className="flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm"
          >
            <Plus size={14} /> إضافة عملة
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 p-3 border rounded bg-gradient-to-l from-blue-50 to-white border-blue-200">
          <div className="text-[12px] text-slate-600">
            {dirty ? (
              <span className="text-amber-700 font-semibold">● يوجد تعديلات لم تُحفظ.</span>
            ) : (
              <span className="text-emerald-700">✓ الأسعار محفوظة.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={reset}
              disabled={!dirty}
              className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} /> استرجاع
            </button>
            <button
              onClick={save}
              className={`flex items-center gap-1 px-4 py-2 rounded text-white text-sm font-semibold shadow-sm ${dirty ? "bg-blue-600 hover:bg-blue-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
            >
              <Save size={15} /> {dirty ? "حفظ الأسعار" : "محفوظ"}
            </button>
          </div>
        </div>
      </Panel>
      {closeGuard.dialog}
    </ErpLayout>
  );
}

function RateInput({
  value, onChange, className, placeholder,
}: { value: number; onChange: (n: number) => void; className?: string; placeholder?: string }) {
  const buf = useNumericBuffer(value || "", true);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={buf.text}
      onFocus={buf.onFocus}
      onBlur={buf.onBlur}
      onChange={(e) => {
        const v = e.target.value;
        if (v !== "" && !/^-?[\d\u0660-\u0669\u06F0-\u06F9]*[.,،\u066B]?[\d\u0660-\u0669\u06F0-\u06F9]*$/.test(v)) return;
        buf.setText(v);
        onChange(parseDecimal(v));
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}