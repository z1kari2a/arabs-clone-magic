import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, FolderOpen, Save, Pencil, Trash2, Search, Printer, FileSpreadsheet, Download, CheckCircle2, X, RefreshCw, Plus, HardDriveDownload, CloudDownload, ImagePlus, RotateCcw } from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import { Panel, FieldRow, ErpInput, ErpSelect, ErpTable, Cell, parseDecimal } from "@/components/erp/ErpUI";
import { erpStore, useErpStore, hydrateStore } from "@/lib/erp-store";
import { useAuth, canWrite, canDelete } from "@/lib/auth";
import { pullLatestCloudBackup, restoreFromCloudBackup, getLastCloudPushAt } from "@/lib/cloud-sync";
import { appIcon, fileToIconDataUrl, normalizeAppName, DEFAULT_APP_NAME } from "@/lib/branding";
import type { PriceTier } from "@/lib/erp-types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "الإعدادات - نظام ERP" },
      { name: "description", content: "إعدادات النظام العامة" },
      { property: "og:title", content: "الإعدادات - نظام ERP" },
      { property: "og:description", content: "شاشة الإعدادات" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const settings = useErpStore((s) => s.settings);
  const hydrated = useErpStore((s) => s.hydrated);
  const [local, setLocal] = useState(settings);

  // `local` is seeded at mount, which can happen before hydrateStore() has
  // read the stored settings — in which case it holds the defaults. Saving
  // that snapshot writes the defaults back over the real values, and a custom
  // app name/icon would disappear on a Save the user never meant as a reset.
  // Re-seed once the real settings land.
  useEffect(() => {
    if (hydrated) setLocal(settings);
  }, [hydrated]);
  // Price tiers drive every sale price on the purchase-order screen, and
  // reset/restore destroy data — gate both behind the right role.
  const { role } = useAuth();
  const mayWrite = canWrite(role);
  const mayReset = canDelete(role);
  const tiers: PriceTier[] = local.priceTiers ?? [];
  const setTiers = (t: PriceTier[]) => setLocal({ ...local, priceTiers: t });
  const addTier = () => !mayWrite ? toast.error("ليس لديك صلاحية لتعديل الإعدادات") : setTiers([...tiers, { id: "t_" + Date.now(), name: "تسعيرة جديدة", extraPct: 0, profitPct: 30 }]);
  const rmTier = (id: string) => !mayWrite ? toast.error("ليس لديك صلاحية لتعديل الإعدادات") : setTiers(tiers.filter((t) => t.id !== id));
  const patchTier = (id: string, p: Partial<PriceTier>) =>
    !mayWrite ? undefined : setTiers(tiers.map((t) => (t.id === id ? { ...t, ...p } : t)));

  // Merge only the fields this page actually edits onto the LATEST live settings —
  // never overwrite the whole object. `local` was seeded from `settings` at mount
  // time (possibly before store hydration finished), so writing it back as-is would
  // silently revert currencies/masterCurrency/expenseTypes to that stale snapshot,
  // undoing rate edits made on "أسعار الصرف" (or anywhere else) in the meantime.
  const onSave = () => {
    if (!mayWrite) return toast.error("ليس لديك صلاحية لتعديل الإعدادات");
    const liveCurrencies = settings.currencies ?? [];
    const defaultCurrency = liveCurrencies.some((c) => c.code === local.defaultCurrency)
      ? local.defaultCurrency
      : settings.defaultCurrency;
    erpStore.set({
      settings: {
        ...settings,
        companyName: local.companyName,
        fiscalYear: local.fiscalYear,
        defaultCurrency,
        language: local.language,
        priceTiers: local.priceTiers,
        // Empty string means "back to the bundled default", and the helpers in
        // branding.ts read a missing field that way — so drop it rather than
        // storing "" and having every screen re-check for it.
        appName: normalizeAppName(local.appName ?? "") || undefined,
        appIcon: local.appIcon || undefined,
      },
    });
    toast.success("تم حفظ الإعدادات");
  };
  const onReset = () => { if (!mayReset) return toast.error("إعادة تعيين النظام تتطلب صلاحية مدير"); if (confirm("إعادة تعيين كل البيانات؟")) { erpStore.reset(); toast.success("تم إعادة التعيين"); location.reload(); } };
  const noop = () => {};

  // ---- App identity (name + icon) ----
  const iconInput = useRef<HTMLInputElement>(null);

  const onPickIcon = async (file: File | undefined) => {
    if (!file) return;
    if (!mayWrite) return toast.error("ليس لديك صلاحية لتعديل الإعدادات");
    try {
      setLocal((prev) => ({ ...prev, appIcon: "" })); // clear a stale preview while decoding
      const dataUrl = await fileToIconDataUrl(file);
      setLocal((prev) => ({ ...prev, appIcon: dataUrl }));
      toast.success("تم تحميل الأيقونة — اضغط حفظ لتطبيقها");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر قراءة الصورة");
    } finally {
      // Without this, picking the same file twice in a row fires no change event.
      if (iconInput.current) iconInput.current.value = "";
    }
  };

  const onClearIcon = () => {
    if (!mayWrite) return toast.error("ليس لديك صلاحية لتعديل الإعدادات");
    setLocal((prev) => ({ ...prev, appIcon: "" }));
  };

  // Cloud backup rides on the license activation, which only the licensed shell
  // build provides. Checked once on mount: reading `window` during render would
  // differ between the server pass and the client one.
  const [cloudAvailable, setCloudAvailable] = useState(false);
  useEffect(() => setCloudAvailable(typeof window !== "undefined" && !!window.erpLicense), []);

  const [lastLocalBackup, setLastLocalBackup] = useState<string | null>(null);
  const [lastCloudBackup, setLastCloudBackup] = useState<string | null>(getLastCloudPushAt());
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // pushCloudBackup() runs on a background debounce/interval (see erp-store.ts's
  // notify()), outside React — poll its last-success timestamp so this screen
  // reflects a push that happened while the user was looking at this page.
  useEffect(() => {
    const t = setInterval(() => setLastCloudBackup(getLastCloudPushAt()), 5000);
    return () => clearInterval(t);
  }, []);

  const onBackupNow = async () => {
    const bridge = window.erpNative;
    if (!bridge?.backupNow) {
      toast.error("النسخ الاحتياطي المحلي متاح فقط داخل تطبيق سطح المكتب");
      return;
    }
    setBackingUp(true);
    try {
      const dest = await bridge.backupNow();
      setLastLocalBackup(new Date().toLocaleString("ar"));
      toast.success(dest ? "تم إنشاء نسخة احتياطية محلية" : "تعذر إنشاء نسخة احتياطية");
    } catch {
      toast.error("تعذر إنشاء نسخة احتياطية");
    } finally {
      setBackingUp(false);
    }
  };

  const onRestoreFromCloud = async () => {
    if (!mayReset) return toast.error("الاستعادة من السحابة تتطلب صلاحية مدير");
    if (!confirm("سيتم استبدال كل البيانات المحلية الحالية بآخر نسخة سحابية محفوظة. هل أنت متأكد؟")) return;
    setRestoring(true);
    try {
      const payload = await pullLatestCloudBackup();
      if (!payload) {
        toast.error("لا توجد نسخة سحابية محفوظة لهذا الترخيص");
        return;
      }
      await restoreFromCloudBackup(payload);
      await hydrateStore();
      toast.success("تم استرجاع البيانات من السحابة");
    } catch {
      toast.error("تعذر الاتصال بالسحابة (تأكد من تفعيل الترخيص واتصال الإنترنت)");
    } finally {
      setRestoring(false);
    }
  };

  const actions = [
    { icon: FilePlus2, label: "جديد", color: "text-emerald-600", onClick: noop },
    { icon: FolderOpen, label: "فتح", color: "text-amber-500", onClick: noop },
    { icon: Save, label: "حفظ", color: "text-blue-600", onClick: onSave, disabled: !mayWrite },
    { icon: Pencil, label: "تعديل", color: "text-cyan-600", onClick: noop },
    { icon: Trash2, label: "حذف", color: "text-rose-600", onClick: noop },
    { icon: Search, label: "بحث", color: "text-indigo-500", onClick: noop },
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: () => window.print() },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: noop },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: noop },
    { icon: CheckCircle2, label: "اعتماد", color: "text-emerald-700", onClick: onSave, disabled: !mayWrite },
    { icon: X, label: "إغلاق", color: "text-rose-600", onClick: () => history.back() },
  ];

  return (
    <ErpLayout title="الإعدادات" ribbon={<Ribbon actions={actions} />}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 max-w-4xl">
        <Panel title="إعدادات الشركة">
          <div className="space-y-2">
            <FieldRow label="اسم الشركة"><ErpInput value={local.companyName} onChange={(v) => setLocal({ ...local, companyName: v })} align="right" /></FieldRow>
            <FieldRow label="السنة المالية"><ErpInput value={local.fiscalYear} onChange={(v) => setLocal({ ...local, fiscalYear: v })} align="right" /></FieldRow>
            <FieldRow label="العملة الافتراضية">
              <ErpSelect
                value={local.defaultCurrency}
                onChange={(v) => setLocal({ ...local, defaultCurrency: v })}
                // Sourced from the LIVE store (not `local`) so a currency added/removed/renamed
                // on "أسعار الصرف" shows up immediately — an option here that isn't in
                // settings.currencies has no exchange rate, so every screen silently falls back to 1:1.
                options={(settings.currencies ?? []).map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
              />
            </FieldRow>
            <FieldRow label="اللغة">
              <ErpSelect value={local.language} onChange={(v) => setLocal({ ...local, language: v as any })} options={[
                { value: "ar", label: "العربية" },
                { value: "en", label: "English" },
              ]} />
            </FieldRow>
          </div>
        </Panel>
        <Panel title="إدارة البيانات">
          <div className="space-y-3 text-xs text-slate-600">
            <p>
              يتم تخزين بيانات النظام محلياً على هذا الجهاز، مع نسخ احتياطي تلقائي دوري
              {lastLocalBackup ? ` — آخر نسخة يدوية: ${lastLocalBackup}` : ""}.
            </p>
            {cloudAvailable ? (
              <p>
                النسخ السحابي (يتطلب ترخيصاً فعّالاً واتصال إنترنت):{" "}
                {lastCloudBackup
                  ? new Date(lastCloudBackup).toLocaleString("ar")
                  : "لم تتم أي مزامنة بعد"}
              </p>
            ) : (
              <p>
                هذه نسخة تعمل بلا إنترنت — لا يوجد نسخ سحابي، والنسخ الاحتياطية تُحفظ داخل مجلد
                البيانات.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onBackupNow}
                disabled={backingUp}
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                <HardDriveDownload size={14} /> {backingUp ? "جارٍ النسخ..." : "نسخ احتياطي الآن"}
              </button>
              {/* Offered only where it can actually work. In the offline
                  desktop build there is no license bridge, so this button could
                  do nothing but fail — and a button that always fails reads as
                  a broken program. */}
              {cloudAvailable && (
                <button
                  onClick={onRestoreFromCloud}
                  disabled={restoring}
                  className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <CloudDownload size={14} /> {restoring ? "جارٍ الاسترجاع..." : "استعادة من السحابة"}
                </button>
              )}
              <button onClick={onReset} className="flex items-center gap-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded text-rose-700 hover:bg-rose-100">
                <RefreshCw size={14} /> إعادة تعيين النظام
              </button>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="هوية التطبيق (الاسم والأيقونة)" className="mt-2">
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-start">
          <div className="flex flex-col items-center gap-2">
            <img
              src={local.appIcon || appIcon(settings)}
              alt="أيقونة التطبيق"
              className="w-20 h-20 rounded-xl object-contain border border-slate-300 bg-white p-1"
            />
            <input
              ref={iconInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => void onPickIcon(e.target.files?.[0])}
            />
            <div className="flex gap-1">
              <button
                onClick={() => iconInput.current?.click()}
                disabled={!mayWrite}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-blue-300 rounded hover:bg-blue-50 disabled:opacity-50"
              >
                <ImagePlus size={12} className="text-blue-600" /> اختيار صورة
              </button>
              <button
                onClick={onClearIcon}
                disabled={!mayWrite || !(local.appIcon || settings.appIcon)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw size={12} className="text-slate-600" /> الافتراضية
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <FieldRow label="اسم التطبيق">
              <ErpInput
                value={local.appName ?? ""}
                onChange={(v) => setLocal({ ...local, appName: v })}
                align="right"
                placeholder={DEFAULT_APP_NAME}
              />
            </FieldRow>
            <div className="text-xs text-slate-600 space-y-1">
              <p>
                الاسم والأيقونة يظهران في شريط عنوان البرنامج وتبويب المتصفح، ويُحفظان مع بقية
                الإعدادات — فتُزامَن تلقائياً إلى بقية الأجهزة عند النسخ الاحتياطي السحابي.
              </p>
              <p>اترك الاسم فارغاً للعودة إلى الاسم الافتراضي. الصورة تُصغَّر تلقائياً إلى 256×256.</p>
              <p className="text-amber-700">
                ملاحظة: أيقونة ملف التثبيت وأيقونة الاختصار على سطح المكتب مدمجة داخل ملف
                البرنامج نفسه ولا تتغيّر من هنا — تتغيّر أيقونة النافذة وشريط المهام فقط.
              </p>
            </div>
            <button
              onClick={onSave}
              disabled={!mayWrite}
              className="flex items-center gap-2 px-3 py-2 text-xs bg-blue-50 border border-blue-200 rounded text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              <Save size={14} /> حفظ وتطبيق
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="تسعيرات الفروع / الوجهات" className="mt-2">
        <div className="flex justify-between items-center mb-2">
          <div className="text-xs text-slate-600">
            كل تسعيرة تُضيف نسبة على متوسط التكلفة (مصاريف وجهة) + نسبة ربح. تنعكس مباشرة على شاشة أمر الشراء.
          </div>
          <button onClick={addTier} className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-emerald-300 rounded hover:bg-emerald-50">
            <Plus size={12} className="text-emerald-600" /> إضافة تسعيرة
          </button>
        </div>
        <ErpTable headers={["م", "اسم التسعيرة", "نسبة إضافية على التكلفة %", "نسبة الربح %", "حذف"]}>
          {tiers.map((t, i) => (
            <tr key={t.id} className="odd:bg-white even:bg-slate-50/50">
              <td className="border border-slate-200 text-center text-slate-500 w-10">{i + 1}</td>
              <Cell value={t.name} onChange={(v) => patchTier(t.id, { name: v })} align="right" />
              <Cell value={t.extraPct} onChange={(v) => patchTier(t.id, { extraPct: parseDecimal(v) })} align="right" type="number" />
              <Cell value={t.profitPct} onChange={(v) => patchTier(t.id, { profitPct: parseDecimal(v) })} align="right" type="number" />
              <td className="border border-slate-200 text-center">
                <button onClick={() => rmTier(t.id)} className="text-rose-600 hover:bg-rose-50 px-2 rounded"><Trash2 size={12} /></button>
              </td>
            </tr>
          ))}
        </ErpTable>
      </Panel>

    </ErpLayout>
  );
}

