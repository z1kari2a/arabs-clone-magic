import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listLicenses,
  createLicense,
  toggleLicense,
  extendLicense,
  revokeActivation,
  listBundles,
  uploadBundle,
  setCurrentBundle,
} from "@/lib/license-admin.functions";

export const Route = createFileRoute("/admin/licenses")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "لوحة التراخيص" },
      { name: "description", content: "إدارة تراخيص وتفعيلات نظام ERP" },
    ],
  }),
  component: AdminLicensesPage,
  errorComponent: LicensesErrorPanel,
  notFoundComponent: () => <div className="p-8">الصفحة غير موجودة</div>,
});

/**
 * مكوّن مستقلّ باسم يبدأ بحرف كبير، لا دالة مجهولة داخل خيارات المسار.
 * الراوتر يرسمه مكوّناً في الحالتين، لكن `useRouter` داخل دالة لا يعرفها
 * المُلَقِّط مكوّناً كان يكسر قاعدة الخطّافات — وهو الخطأ الحقيقي الوحيد الذي
 * كان يختبئ تحت ركام أخطاء التنسيق.
 */
function LicensesErrorPanel({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="p-8 text-center">
      <p className="text-red-600">حدث خطأ: {String(error.message ?? error)}</p>
      <button
        className="mt-4 rounded bg-blue-600 px-4 py-2 text-white"
        onClick={() => {
          router.invalidate();
          reset();
        }}
      >
        إعادة المحاولة
      </button>
    </div>
  );
}

type Session = { email: string | null; userId: string } | null;

function AdminLicensesPage() {
  const [session, setSession] = useState<Session>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setSession(data.user ? { email: data.user.email ?? null, userId: data.user.id } : null);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => {
      setSession(s?.user ? { email: s.user.email ?? null, userId: s.user.id } : null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (checking) return <div className="p-8 text-center text-slate-500">جاري التحقق…</div>;
  if (!session) return <LoginBox />;
  return <Dashboard email={session.email} />;
}

function LoginBox() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4" dir="rtl">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow-md"
      >
        <h1 className="text-xl font-bold">دخول لوحة التراخيص</h1>
        <p className="text-xs text-slate-500">
          مخصصة لك (المطوّر). سجّل دخول بحساب Supabase الذي له دور <b>admin</b>.
        </p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="البريد الإلكتروني"
          required
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="كلمة السر"
          required
          className="w-full rounded border px-3 py-2 text-sm"
        />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "..." : "دخول"}
        </button>
        <Link to="/" className="block text-center text-xs text-slate-500 hover:underline">
          العودة للنظام
        </Link>
      </form>
    </div>
  );
}

function Dashboard({ email }: { email: string | null }) {
  const fnList = useServerFn(listLicenses);
  const fnCreate = useServerFn(createLicense);
  const fnToggle = useServerFn(toggleLicense);
  const fnExtend = useServerFn(extendLicense);
  const fnRevoke = useServerFn(revokeActivation);
  const fnBundles = useServerFn(listBundles);
  const fnUpload = useServerFn(uploadBundle);
  const fnSetCurrent = useServerFn(setCurrentBundle);

  const licensesQ = useQuery({ queryKey: ["admin-licenses"], queryFn: () => fnList() });
  const bundlesQ = useQuery({ queryKey: ["admin-bundles"], queryFn: () => fnBundles() });

  const [form, setForm] = useState({
    license_type: "monthly" as "monthly" | "permanent",
    max_devices: 1,
    months: 1,
    customer_name: "",
    notes: "",
  });

  const createMut = useMutation({
    mutationFn: (d: typeof form) => fnCreate({ data: d }),
    onSuccess: () => licensesQ.refetch(),
  });
  const toggleMut = useMutation({
    mutationFn: (d: { id: string; active: boolean }) => fnToggle({ data: d }),
    onSuccess: () => licensesQ.refetch(),
  });
  const extendMut = useMutation({
    mutationFn: (d: { id: string; months: number }) => fnExtend({ data: d }),
    onSuccess: () => licensesQ.refetch(),
  });
  const revokeMut = useMutation({
    mutationFn: (d: { id: string }) => fnRevoke({ data: d }),
    onSuccess: () => licensesQ.refetch(),
  });
  const uploadMut = useMutation({
    mutationFn: (d: {
      version: string;
      plaintext_b64: string;
      notes?: string;
      make_current: boolean;
    }) => fnUpload({ data: d }),
    onSuccess: () => bundlesQ.refetch(),
  });
  const setCurrentMut = useMutation({
    mutationFn: (d: { id: string }) => fnSetCurrent({ data: d }),
    onSuccess: () => bundlesQ.refetch(),
  });

  const licenses = (licensesQ.data?.licenses ?? []) as any[];
  // نفس علّة شاشة المصروفات: `?? []` يُنتج مصفوفة جديدة كل رسم، فتُبطِل ذاكرة
  // `byLicense` أدناه ويُعاد بناء الخريطة في كل مرة.
  const activations = useMemo(
    () => (licensesQ.data?.activations ?? []) as any[],
    [licensesQ.data?.activations],
  );
  const byLicense = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const a of activations) {
      const arr = m.get(a.license_id) ?? [];
      arr.push(a);
      m.set(a.license_id, arr);
    }
    return m;
  }, [activations]);

  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleString("ar-EG", { hour12: false }) : "—";

  return (
    <div className="min-h-screen bg-slate-100 p-6" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">لوحة التراخيص</h1>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded border px-3 py-1 hover:bg-slate-200"
            >
              خروج
            </button>
          </div>
        </div>

        <section className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-4 text-lg font-semibold">إنشاء ترخيص جديد</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <select
              value={form.license_type}
              onChange={(e) => setForm({ ...form, license_type: e.target.value as any })}
              className="rounded border px-2 py-2 text-sm"
            >
              <option value="monthly">اشتراك شهري</option>
              <option value="permanent">اشتراك دائم</option>
            </select>
            <input
              type="number"
              min={1}
              max={50}
              value={form.max_devices}
              onChange={(e) => setForm({ ...form, max_devices: +e.target.value })}
              placeholder="أجهزة"
              className="rounded border px-2 py-2 text-sm"
            />
            {form.license_type === "monthly" ? (
              <input
                type="number"
                min={1}
                max={120}
                value={form.months}
                onChange={(e) => setForm({ ...form, months: +e.target.value })}
                placeholder="أشهر"
                className="rounded border px-2 py-2 text-sm"
              />
            ) : (
              <div className="rounded border bg-slate-50 px-2 py-2 text-center text-xs text-slate-500">
                لا ينتهي
              </div>
            )}
            <input
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              placeholder="اسم العميل"
              className="rounded border px-2 py-2 text-sm"
            />
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="ملاحظات"
              className="rounded border px-2 py-2 text-sm"
            />
            <button
              onClick={() => createMut.mutate(form)}
              disabled={createMut.isPending}
              className="rounded bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {createMut.isPending ? "..." : "إنشاء"}
            </button>
          </div>
          {createMut.data && (
            <div className="mt-4 rounded bg-emerald-50 p-3 text-sm">
              <b>رمز التفعيل: </b>
              <span className="rounded bg-white px-2 py-1 font-mono">
                {(createMut.data as any).code}
              </span>
              <span className="mr-3 text-emerald-700">أرسله للعميل.</span>
            </div>
          )}
          {createMut.error && (
            <p className="mt-2 text-xs text-red-600">
              {String((createMut.error as Error).message)}
            </p>
          )}
        </section>

        <section className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-4 text-lg font-semibold">التراخيص ({licenses.length})</h2>
          {licensesQ.isLoading ? (
            <p className="text-sm text-slate-500">جار التحميل…</p>
          ) : licensesQ.error ? (
            <p className="text-sm text-red-600">
              خطأ: {String((licensesQ.error as Error).message)} — تأكد أن حسابك بدور admin.
            </p>
          ) : (
            <div className="space-y-3">
              {licenses.map((l) => {
                const acts = byLicense.get(l.id) ?? [];
                const activeCount = acts.filter((a) => !a.revoked).length;
                const expired = l.expires_at && new Date(l.expires_at).getTime() < Date.now();
                return (
                  <div key={l.id} className="rounded border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-mono text-sm">{l.code}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {l.license_type === "permanent" ? "دائم" : "شهري"} · أجهزة {activeCount}/
                          {l.max_devices}
                          {l.expires_at ? ` · ينتهي ${fmt(l.expires_at)}` : " · بلا انتهاء"}
                          {expired && <span className="text-red-600"> (منتهي)</span>}
                          {l.customer_name && <span> · {l.customer_name}</span>}
                          {l.notes && <span> · {l.notes}</span>}
                          {!l.active && <span className="text-amber-600"> · معطل</span>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <button
                          onClick={() => toggleMut.mutate({ id: l.id, active: !l.active })}
                          className={`rounded px-3 py-1 text-white ${l.active ? "bg-amber-500" : "bg-emerald-600"}`}
                        >
                          {l.active ? "تعطيل" : "تفعيل"}
                        </button>
                        {l.license_type === "monthly" && (
                          <button
                            onClick={() => extendMut.mutate({ id: l.id, months: 1 })}
                            className="rounded bg-blue-500 px-3 py-1 text-white"
                          >
                            +شهر
                          </button>
                        )}
                      </div>
                    </div>
                    {acts.length > 0 && (
                      <div className="mt-3 space-y-1 border-t pt-2 text-xs">
                        {acts.map((a) => (
                          <div key={a.id} className="flex items-center justify-between">
                            <span className={a.revoked ? "text-slate-400 line-through" : ""}>
                              {a.device_name || "بدون اسم"} · {a.machine_fingerprint.slice(0, 12)}…
                              · آخر ظهور {fmt(a.last_seen_at)}
                            </span>
                            {!a.revoked && (
                              <button
                                onClick={() => revokeMut.mutate({ id: a.id })}
                                className="rounded bg-red-500 px-2 py-0.5 text-white"
                              >
                                إلغاء
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {licenses.length === 0 && (
                <p className="text-sm text-slate-500">لا توجد تراخيص بعد.</p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-4 text-lg font-semibold">حزم البرنامج (Bundles)</h2>
          <BundleUploader onUpload={(p) => uploadMut.mutate(p)} busy={uploadMut.isPending} />
          {uploadMut.error && (
            <p className="mt-2 text-xs text-red-600">
              {String((uploadMut.error as Error).message)}
            </p>
          )}
          <div className="mt-4 space-y-2 text-sm">
            {((bundlesQ.data ?? []) as any[]).map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
              >
                <div>
                  <b>v{b.version}</b>{" "}
                  <span className="text-xs text-slate-500">
                    ({((b.size_bytes ?? 0) / 1024).toFixed(1)} KB) · {fmt(b.created_at)}
                  </span>
                  {b.is_current && (
                    <span className="mr-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      الحالي
                    </span>
                  )}
                </div>
                {!b.is_current && (
                  <button
                    onClick={() => setCurrentMut.mutate({ id: b.id })}
                    className="rounded bg-blue-600 px-3 py-1 text-xs text-white"
                  >
                    اجعله الحالي
                  </button>
                )}
              </div>
            ))}
            {((bundlesQ.data ?? []) as any[]).length === 0 && (
              <p className="text-slate-500">لا توجد حزم مرفوعة بعد.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function BundleUploader({
  onUpload,
  busy,
}: {
  onUpload: (p: {
    version: string;
    plaintext_b64: string;
    notes?: string;
    make_current: boolean;
  }) => void;
  busy: boolean;
}) {
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [file, setFile] = useState<File | null>(null);

  const handle = async () => {
    if (!file || !version) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    onUpload({ version, plaintext_b64: b64, notes, make_current: makeCurrent });
  };

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
      <input
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        placeholder="الإصدار (1.0.0)"
        className="rounded border px-2 py-2 text-sm"
      />
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="rounded border px-2 py-2 text-sm md:col-span-2"
      />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={makeCurrent}
          onChange={(e) => setMakeCurrent(e.target.checked)}
        />
        اجعلها النسخة الحالية
      </label>
      <button
        onClick={handle}
        disabled={busy || !file || !version}
        className="rounded bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? "..." : "رفع + تشفير"}
      </button>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="ملاحظات (اختياري)"
        className="rounded border px-2 py-2 text-sm md:col-span-5"
      />
    </div>
  );
}
