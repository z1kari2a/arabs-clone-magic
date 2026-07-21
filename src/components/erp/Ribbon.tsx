import type { LucideIcon } from "lucide-react";

export type RibbonAction = {
  icon: LucideIcon;
  label: string;
  color: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
};

export default function Ribbon({ actions }: { actions: RibbonAction[] }) {
  return (
    <>
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={a.onClick}
          disabled={a.disabled}
          title={a.hint ? `${a.label} (${a.hint})` : a.label}
          className="group flex flex-col items-center justify-center px-2.5 py-1 min-w-[68px] rounded border border-transparent hover:bg-blue-50 hover:border-blue-200 active:bg-blue-100 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-transparent"
        >
          <a.icon size={26} className={a.color} strokeWidth={1.6} />
          <span className="text-[11px] mt-0.5 text-slate-700 whitespace-nowrap font-medium">{a.label}</span>
          {a.hint && <span className="text-[9px] text-slate-400 leading-none">{a.hint}</span>}
        </button>
      ))}
    </>
  );
}

export const STANDARD_ORDER = [
  "جديد",
  "فتح",
  "حفظ",
  "تعديل",
  "حذف",
  "بحث",
  "طباعة",
  "استيراد Excel",
  "تصدير Excel",
  "اعتماد",
  "إغلاق",
];