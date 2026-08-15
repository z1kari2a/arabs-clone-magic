// "تحديثات البرنامج" — the settings card for automatic updates.
//
// All the work happens in the main process (electron/updater.cjs); this only
// mirrors the state it pushes. Rendered in the browser build too, where it says
// so plainly rather than showing buttons that could not work.

import { useEffect, useState } from "react";
import { RefreshCw, Download, RotateCcw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Panel } from "@/components/erp/ErpUI";
import type { UpdateState } from "@/lib/local-db";

const IDLE: UpdateState = {
  phase: "idle",
  currentVersion: "",
  version: null,
  notes: null,
  percent: 0,
  error: null,
  checkedAt: null,
  auto: true,
  supported: false,
};

export default function UpdatePanel({ className = "" }: { className?: string }) {
  const [state, setState] = useState<UpdateState>(IDLE);
  // An installed copy from before this feature shipped has a preload without
  // `updates`, so the bridge is looked up once on mount and everything below
  // treats "missing" the same as "not the desktop build".
  const [bridge, setBridge] = useState<NonNullable<Window["erpNative"]>["updates"]>(undefined);
  const [busy, setBusy] = useState(false);
  // Nothing is known about the phase until the first state arrives, and
  // rendering "not supported" for that instant would flicker.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const updates = typeof window === "undefined" ? undefined : window.erpNative?.updates;
    setBridge(updates);
    if (!updates) {
      setLoaded(true);
      return;
    }
    void updates.state().then((s) => {
      setState(s);
      setLoaded(true);
    });
    return updates.onState(setState);
  }, []);

  // No bridge at all in the browser build; a bridge but `supported: false` when
  // running from source (`npm run electron:start`) — there is no installed copy
  // to replace there, so the buttons would do nothing.
  if (loaded && (!bridge || !state.supported)) {
    return (
      <Panel title="تحديثات البرنامج" className={className}>
        <p className="text-xs text-slate-600">
          التحديث التلقائي يعمل داخل النسخة المثبّتة على Windows فقط
          {state.currentVersion ? ` (الإصدار الحالي: ${state.currentVersion})` : ""}.
        </p>
      </Panel>
    );
  }

  if (!bridge) return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const checking = state.phase === "checking" || busy;

  return (
    <Panel title="تحديثات البرنامج" className={className}>
      <div className="space-y-3 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            الإصدار الحالي: <span className="font-semibold">{state.currentVersion || "—"}</span>
          </span>
          {state.checkedAt && (
            <span className="text-slate-500">
              آخر تحقق: {new Date(state.checkedAt).toLocaleString("ar")}
            </span>
          )}
        </div>

        <Status state={state} />

        {state.phase === "downloading" && (
          <div className="h-2 w-full max-w-sm rounded bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-[width] duration-300"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        )}

        {state.notes && (state.phase === "available" || state.phase === "ready") && (
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-5 font-sans">
            {state.notes}
          </pre>
        )}

        <div className="flex flex-wrap gap-2">
          {state.phase === "ready" ? (
            <button
              onClick={() => void run(() => bridge.install())}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-700 hover:bg-emerald-100"
            >
              <RotateCcw size={14} /> إعادة التشغيل والتثبيت
            </button>
          ) : state.phase === "available" ? (
            <button
              onClick={() => void run(() => bridge.download())}
              className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-blue-700 hover:bg-blue-100"
            >
              <Download size={14} /> تنزيل التحديث
            </button>
          ) : null}

          <button
            onClick={() => void run(() => bridge.check())}
            disabled={checking || state.phase === "downloading"}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={checking ? "animate-spin" : ""} />
            {checking ? "جارٍ التحقق..." : "التحقق الآن"}
          </button>
        </div>

        <label className="flex items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={state.auto}
            onChange={(e) => void run(() => bridge.setAuto(e.target.checked))}
            className="accent-blue-600"
          />
          <span>التحقق من التحديثات وتنزيلها تلقائياً في الخلفية</span>
        </label>

        <p className="text-slate-500">
          يحتاج التحديث إلى اتصال بالإنترنت لحظة التنزيل فقط — البرنامج نفسه يظل يعمل بلا إنترنت،
          وبياناتك تبقى على هذا الجهاز ولا تتأثر بالتحديث.
        </p>
      </div>
    </Panel>
  );
}

function Status({ state }: { state: UpdateState }) {
  if (state.phase === "error")
    return (
      <p className="flex items-center gap-2 text-amber-700">
        <AlertTriangle size={14} /> {state.error ?? "تعذّر التحديث."}
      </p>
    );

  if (state.phase === "ready")
    return (
      <p className="flex items-center gap-2 text-emerald-700">
        <CheckCircle2 size={14} /> الإصدار {state.version} جاهز — أعد تشغيل البرنامج لتثبيته.
      </p>
    );

  if (state.phase === "downloading")
    return (
      <p className="text-blue-700">
        جارٍ تنزيل الإصدار {state.version}… {state.percent}%
      </p>
    );

  if (state.phase === "available")
    return <p className="text-blue-700">يتوفر الإصدار {state.version}.</p>;

  if (state.phase === "none")
    return (
      <p className="flex items-center gap-2 text-emerald-700">
        <CheckCircle2 size={14} /> البرنامج محدّث.
      </p>
    );

  return <p className="text-slate-500">لم يتم التحقق بعد.</p>;
}
