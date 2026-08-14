import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FilePlus2,
  FolderOpen,
  Save,
  Pencil,
  Trash2,
  Search,
  Printer,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  X,
  RefreshCw,
  Plus,
  HardDriveDownload,
  CloudDownload,
  ImagePlus,
  RotateCcw,
} from "lucide-react";
import ErpLayout from "@/components/erp/ErpLayout";
import Ribbon from "@/components/erp/Ribbon";
import {
  Panel,
  FieldRow,
  ErpInput,
  ErpSelect,
  ErpTable,
  Cell,
  parseDecimal,
} from "@/components/erp/ErpUI";
import { erpStore, useErpStore, hydrateStore } from "@/lib/erp-store";
import { useAuth, canWrite, canDelete } from "@/lib/auth";
import {
  pullLatestCloudBackup,
  restoreFromCloudBackup,
  getLastCloudPushAt,
} from "@/lib/cloud-sync";
import { appIcon, fileToIconDataUrl, normalizeAppName, DEFAULT_APP_NAME } from "@/lib/branding";
import type { CompanyProfile, PriceTier } from "@/lib/erp-types";

/**
 * The company/branch card. Every field is optional — nothing here is validated
 * or required, and a blank card is a perfectly valid one — so the definitions
 * carry only a label and, where it isn't plain text, an input kind.
 */
type CompanyFieldDef = {
  key: keyof CompanyProfile;
  label: string;
  kind?: "text" | "date" | "bool";
};

const IDENTITY_SECTION: CompanyFieldDef[] = [
  { key: "companyNo", label: "رقم الشركة" },
  { key: "branchNo", label: "رقم الفرع" },
  { key: "year", label: "السنة" },
  { key: "companyNameEn", label: "الاسم الأجنبي" },
  { key: "branchName", label: "اسم الفرع" },
  { key: "branchNameEn", label: "الاسم الأجنبي (فرع)" },
  { key: "groupNo", label: "رقم المجموعة" },
  { key: "isMain", label: "رئيسي", kind: "bool" },
  { key: "onyxLiteLink", label: "الربط مع نظام الأوفكس لايت", kind: "bool" },
];

const ADDRESS_SECTION: CompanyFieldDef[] = [
  { key: "country", label: "الدولة" },
  { key: "governorateNo", label: "رقم المحافظة" },
  { key: "city", label: "المدينة" },
  { key: "regionNo", label: "رقم المنطقة" },
  { key: "district", label: "الحي" },
  { key: "street", label: "الشارع" },
  { key: "buildingNo", label: "رقم المبنى" },
  { key: "additionalNo", label: "الرقم الإضافي" },
  { key: "postalCode", label: "الرمز البريدي" },
  { key: "shortAddress", label: "العنوان المختصر" },
  { key: "branchAddress", label: "عنوان الفرع" },
  { key: "branchAddressEn", label: "عنوان الفرع بالأجنبي" },
  { key: "phone", label: "رقم التلفون" },
  { key: "website", label: "الموقع الألكتروني" },
  { key: "gps", label: "نظام تحديد المواقع" },
  { key: "longitude", label: "خط الطول" },
  { key: "latitude", label: "خط العرض" },
];

const HEADER_SECTION: CompanyFieldDef[] = [
  { key: "headerLine1", label: "النص الأول للترويسة" },
  { key: "headerLine1En", label: "النص الأول للترويسة بالأجنبي" },
  { key: "headerLine2", label: "النص الثاني للترويسة" },
  { key: "headerLine2En", label: "النص الثاني للترويسة بالأجنبي" },
  { key: "headerLine3", label: "النص الثالث للترويسة" },
  { key: "headerLine3En", label: "النص الثالث للترويسة بالأجنبي" },
  { key: "specs", label: "المواصفات" },
  { key: "specsEn", label: "المواصفات بالأجنبي" },
];

const TAX_SECTION: CompanyFieldDef[] = [
  { key: "taxAuthNo", label: "رقم المصادقة الضريبية" },
  { key: "taxSite", label: "الموقع الضريبي" },
  { key: "taxAccountNan", label: "الحساب الضريبي (نان)" },
  { key: "taxBranchNo", label: "الرقم الضريبي الفرعي" },
  { key: "taxGroupNo", label: "رقم المجموعة الضريبية" },
  { key: "identityType", label: "نوع المعرف" },
  { key: "identityNo", label: "المعرف" },
  { key: "statisticalNo", label: "الرقم الأحصائي" },
  { key: "serial", label: "التسلسل" },
  { key: "socialSecurityNo", label: "رقم تعريف الضمان الاجتماعي" },
  { key: "socialSecurityAgency", label: "اسم وكالة الضمان الاجتماعي" },
  { key: "activityCode", label: "رقم تصنيف النشاط" },
  { key: "activityName", label: "اسم تصنيف النشاط" },
  { key: "customersDebtLimit", label: "إجمالي حد دين العملاء" },
  { key: "posName", label: "منفذ البيع" },
  { key: "suspendDate", label: "تاريخ التوقيف", kind: "date" },
  { key: "suspendReason", label: "سبب التوقيف" },
];

/** Free-form codes the user owns, shown alongside the read-only audit stamps. */
const CODE_SECTION: CompanyFieldDef[] = [
  { key: "version", label: "الإصدار" },
  { key: "code", label: "الكود" },
];

const AUDIT_ROWS: { key: keyof CompanyProfile; label: string; date?: boolean }[] = [
  { key: "createdAt", label: "تاريخ الإدخال", date: true },
  { key: "createdBy", label: "مدخل النظام" },
  { key: "createdDevice", label: "الجهاز المدخل" },
  { key: "updatedAt", label: "تاريخ آخر تعديل", date: true },
  { key: "updatedBy", label: "معدل النظام" },
  { key: "updatedDevice", label: "الجهاز المعدل" },
  { key: "printCount", label: "مرات الطباعة" },
  { key: "editCount", label: "مرات التعديل" },
];

/** Wide enough for "النص الأول للترويسة بالأجنبي" without wrapping. */
const CO_LABEL_W = 190;

const DIGITS_ONLY: (keyof CompanyProfile)[] = [
  "companyNo",
  "branchNo",
  "groupNo",
  "governorateNo",
  "regionNo",
  "buildingNo",
  "additionalNo",
  "postalCode",
  "taxGroupNo",
  "serial",
];
const LATIN_FIELDS: (keyof CompanyProfile)[] = [
  "companyNameEn",
  "branchNameEn",
  "branchAddressEn",
  "headerLine1En",
  "headerLine2En",
  "headerLine3En",
  "specsEn",
];
const ARABIC_RE = /[؀-ۿ]/;

/**
 * A *hint*, never a rule: it appears only once something has been typed, and it
 * never blocks saving — every field on this card is optional by design, and a
 * customer whose tax number is 14 digits must still be able to store it. The
 * message says what's expected and stops there.
 */
function hintFor(key: keyof CompanyProfile, raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const num = Number(v);
  if (DIGITS_ONLY.includes(key) && !/^\d+$/.test(v)) return "أرقام فقط";
  if (LATIN_FIELDS.includes(key) && ARABIC_RE.test(v)) return "يُفضّل كتابته بحروف لاتينية";
  switch (key) {
    case "year":
      return /^\d{4}$/.test(v) ? null : "سنة من أربعة أرقام (مثال: 2026)";
    case "phone":
      return /^[\d+\-\s()]{6,}$/.test(v) ? null : "أرقام ومسافات و + و - فقط";
    case "website":
      return /^[^\s]+\.[^\s]{2,}$/.test(v) ? null : "مثال: www.example.com";
    case "taxAuthNo":
      return /^\d{15}$/.test(v) ? null : "الرقم الضريبي عادةً 15 رقماً";
    case "longitude":
      return isFinite(num) && Math.abs(num) <= 180 ? null : "رقم عشري بين ‎-180 و 180";
    case "latitude":
      return isFinite(num) && Math.abs(num) <= 90 ? null : "رقم عشري بين ‎-90 و 90";
    case "customersDebtLimit":
      return isFinite(num) && num >= 0 ? null : "مبلغ رقمي غير سالب";
    default:
      return null;
  }
}

/**
 * Best-effort machine label for the audit stamps. The renderer has no access to
 * the real hostname (the native bridge doesn't expose one), so this is the
 * platform string — enough to tell a Windows workstation from the web build.
 */
function deviceLabel(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
  return ua.userAgentData?.platform || navigator.platform || "غير معروف";
}

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
  const { role, session } = useAuth();
  const mayWrite = canWrite(role);
  const mayReset = canDelete(role);
  const tiers: PriceTier[] = local.priceTiers ?? [];
  const setTiers = (t: PriceTier[]) => setLocal({ ...local, priceTiers: t });
  const addTier = () =>
    !mayWrite
      ? toast.error("ليس لديك صلاحية لتعديل الإعدادات")
      : setTiers([
          ...tiers,
          { id: "t_" + Date.now(), name: "تسعيرة جديدة", extraPct: 0, profitPct: 30 },
        ]);
  const rmTier = (id: string) =>
    !mayWrite
      ? toast.error("ليس لديك صلاحية لتعديل الإعدادات")
      : setTiers(tiers.filter((t) => t.id !== id));
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
    // Audit stamps belong to the program, not to the form: they're rebuilt from
    // the LIVE record so a print counted while this page was open isn't rolled
    // back by the snapshot `local` took at mount.
    const liveCompany = settings.company ?? {};
    const nowIso = new Date().toISOString();
    const who = session?.fullName || session?.username || "";
    const device = deviceLabel();
    const company = {
      ...liveCompany,
      ...(local.company ?? {}),
      createdAt: liveCompany.createdAt ?? nowIso,
      createdBy: liveCompany.createdBy ?? who,
      createdDevice: liveCompany.createdDevice ?? device,
      updatedAt: nowIso,
      updatedBy: who,
      updatedDevice: device,
      printCount: liveCompany.printCount ?? 0,
      editCount: (liveCompany.editCount ?? 0) + 1,
    };
    setLocal((prev) => ({ ...prev, company }));
    erpStore.set({
      settings: {
        ...settings,
        company,
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
  // ---- Company / branch card ----
  const co: CompanyProfile = local.company ?? {};
  const patchCo = (p: Partial<CompanyProfile>) =>
    !mayWrite
      ? toast.error("ليس لديك صلاحية لتعديل الإعدادات")
      : setLocal((prev) => ({ ...prev, company: { ...(prev.company ?? {}), ...p } }));

  // Plain function, not a component: returning elements from a nested component
  // defined during render would remount every input on each keystroke and drop
  // the caret.
  const coFields = (defs: CompanyFieldDef[]) =>
    defs.map((f) =>
      f.kind === "bool" ? (
        <FieldRow key={f.key} label={f.label} labelWidth={CO_LABEL_W}>
          <input
            type="checkbox"
            checked={!!co[f.key]}
            disabled={!mayWrite}
            onChange={(e) => patchCo({ [f.key]: e.target.checked } as Partial<CompanyProfile>)}
            className="w-4 h-4 accent-blue-600 disabled:opacity-50"
          />
        </FieldRow>
      ) : (
        <FieldRow key={f.key} label={f.label} labelWidth={CO_LABEL_W}>
          {(() => {
            const hint = hintFor(f.key, co[f.key]);
            return (
              <div>
                <ErpInput
                  value={(co[f.key] as string | undefined) ?? ""}
                  onChange={(v) => patchCo({ [f.key]: v } as Partial<CompanyProfile>)}
                  disabled={!mayWrite}
                  align="right"
                  type={f.kind === "date" ? "date" : "text"}
                  className={hint ? "!border-amber-400" : ""}
                />
                {hint && <div className="text-[10px] text-amber-700 mt-0.5">{hint}</div>}
              </div>
            );
          })()}
        </FieldRow>
      ),
    );

  const auditText = (r: (typeof AUDIT_ROWS)[number]) => {
    const v = co[r.key];
    if (v === undefined || v === "") return "—";
    if (r.date) {
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? String(v) : d.toLocaleString("ar");
    }
    return String(v);
  };

  // The ribbon's print button owns "مرات الطباعة" — counting it anywhere else
  // would need every screen to remember to.
  const onPrint = () => {
    const liveCompany = settings.company ?? {};
    const company = { ...liveCompany, printCount: (liveCompany.printCount ?? 0) + 1 };
    erpStore.set({ settings: { ...settings, company } });
    setLocal((prev) => ({
      ...prev,
      company: { ...(prev.company ?? {}), printCount: company.printCount },
    }));
    window.print();
  };

  const onReset = () => {
    if (!mayReset) return toast.error("إعادة تعيين النظام تتطلب صلاحية مدير");
    if (confirm("إعادة تعيين كل البيانات؟")) {
      erpStore.reset();
      toast.success("تم إعادة التعيين");
      location.reload();
    }
  };
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
    if (!confirm("سيتم استبدال كل البيانات المحلية الحالية بآخر نسخة سحابية محفوظة. هل أنت متأكد؟"))
      return;
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
    { icon: Printer, label: "طباعة", color: "text-slate-600", onClick: onPrint },
    { icon: FileSpreadsheet, label: "استيراد Excel", color: "text-green-600", onClick: noop },
    { icon: Download, label: "تصدير Excel", color: "text-teal-600", onClick: noop },
    {
      icon: CheckCircle2,
      label: "اعتماد",
      color: "text-emerald-700",
      onClick: onSave,
      disabled: !mayWrite,
    },
    { icon: X, label: "إغلاق", color: "text-rose-600", onClick: () => history.back() },
  ];

  return (
    <ErpLayout title="الإعدادات" ribbon={<Ribbon actions={actions} />}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 max-w-4xl">
        <Panel title="إعدادات الشركة">
          <div className="space-y-2">
            <FieldRow label="اسم الشركة">
              <ErpInput
                value={local.companyName}
                onChange={(v) => setLocal({ ...local, companyName: v })}
                align="right"
              />
            </FieldRow>
            <FieldRow label="السنة المالية">
              <ErpInput
                value={local.fiscalYear}
                onChange={(v) => setLocal({ ...local, fiscalYear: v })}
                align="right"
              />
            </FieldRow>
            <FieldRow label="العملة الافتراضية">
              <ErpSelect
                value={local.defaultCurrency}
                onChange={(v) => setLocal({ ...local, defaultCurrency: v })}
                // Sourced from the LIVE store (not `local`) so a currency added/removed/renamed
                // on "أسعار الصرف" shows up immediately — an option here that isn't in
                // settings.currencies has no exchange rate, so every screen silently falls back to 1:1.
                options={(settings.currencies ?? []).map((c) => ({
                  value: c.code,
                  label: `${c.code} - ${c.name}`,
                }))}
              />
            </FieldRow>
            <FieldRow label="اللغة">
              <ErpSelect
                value={local.language}
                onChange={(v) => setLocal({ ...local, language: v as any })}
                options={[
                  { value: "ar", label: "العربية" },
                  { value: "en", label: "English" },
                ]}
              />
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
                  <CloudDownload size={14} />{" "}
                  {restoring ? "جارٍ الاسترجاع..." : "استعادة من السحابة"}
                </button>
              )}
              <button
                onClick={onReset}
                className="flex items-center gap-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded text-rose-700 hover:bg-rose-100"
              >
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
              <p>
                اترك الاسم فارغاً للعودة إلى الاسم الافتراضي. الصورة تُصغَّر تلقائياً إلى 256×256.
              </p>
              <p className="text-amber-700">
                ملاحظة: أيقونة ملف التثبيت وأيقونة الاختصار على سطح المكتب مدمجة داخل ملف البرنامج
                نفسه ولا تتغيّر من هنا — تتغيّر أيقونة النافذة وشريط المهام فقط.
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

      <Panel title="بيانات الشركة والفرع" className="mt-2">
        <div className="text-xs text-slate-600 mb-2">
          كل الحقول التالية اختيارية — يمكن ترك أي منها فارغاً، ولا يمنع ذلك الحفظ أو استخدام
          النظام. تُحفظ مع بقية الإعدادات بالضغط على «حفظ».
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-2">
          <FieldRow label="اسم الشركة" labelWidth={CO_LABEL_W}>
            {/* Same value as the field in "إعدادات الشركة" above — one stored
                company name, shown wherever the user looks for it. */}
            <ErpInput
              value={local.companyName}
              onChange={(v) => setLocal({ ...local, companyName: v })}
              disabled={!mayWrite}
              align="right"
            />
          </FieldRow>
          {coFields(IDENTITY_SECTION)}
        </div>
      </Panel>

      <Panel title="العنوان ووسائل الاتصال" className="mt-2">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-2">
          {coFields(ADDRESS_SECTION)}
        </div>
      </Panel>

      <Panel title="ترويسة الطباعة والمواصفات" className="mt-2">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-2">
          {coFields(HEADER_SECTION)}
        </div>
      </Panel>

      <Panel title="البيانات الضريبية والقانونية" className="mt-2">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-2">
          {coFields(TAX_SECTION)}
        </div>
      </Panel>

      <Panel title="معلومات النظام" className="mt-2">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-2">
          {coFields(CODE_SECTION)}
          {/* Filled by the program on save/print — shown for reference, not typed. */}
          {AUDIT_ROWS.map((r) => (
            <FieldRow key={r.key} label={r.label} labelWidth={CO_LABEL_W}>
              <div className="px-2 py-1 text-xs border border-slate-200 rounded bg-slate-50 text-slate-700 text-right">
                {auditText(r)}
              </div>
            </FieldRow>
          ))}
        </div>
      </Panel>

      <Panel title="تسعيرات الفروع / الوجهات" className="mt-2">
        <div className="flex justify-between items-center mb-2">
          <div className="text-xs text-slate-600">
            كل تسعيرة تُضيف نسبة على متوسط التكلفة (مصاريف وجهة) + نسبة ربح. تنعكس مباشرة على شاشة
            أمر الشراء.
          </div>
          <button
            onClick={addTier}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-emerald-300 rounded hover:bg-emerald-50"
          >
            <Plus size={12} className="text-emerald-600" /> إضافة تسعيرة
          </button>
        </div>
        <ErpTable
          headers={["م", "اسم التسعيرة", "نسبة إضافية على التكلفة %", "نسبة الربح %", "حذف"]}
        >
          {tiers.map((t, i) => (
            <tr key={t.id} className="odd:bg-white even:bg-slate-50/50">
              <td className="border border-slate-200 text-center text-slate-500 w-10">{i + 1}</td>
              <Cell value={t.name} onChange={(v) => patchTier(t.id, { name: v })} align="right" />
              <Cell
                value={t.extraPct}
                onChange={(v) => patchTier(t.id, { extraPct: parseDecimal(v) })}
                align="right"
                type="number"
              />
              <Cell
                value={t.profitPct}
                onChange={(v) => patchTier(t.id, { profitPct: parseDecimal(v) })}
                align="right"
                type="number"
              />
              <td className="border border-slate-200 text-center">
                <button
                  onClick={() => rmTier(t.id)}
                  className="text-rose-600 hover:bg-rose-50 px-2 rounded"
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </ErpTable>
      </Panel>
    </ErpLayout>
  );
}
