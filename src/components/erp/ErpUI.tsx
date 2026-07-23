import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export const fmt = (n: number, d = 2) =>
  (isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
export const fmtInt = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-US");

/** Parse a decimal number written with either `.` or `,` as decimal separator. */
export const parseDecimal = (value: string | number): number => {
  if (typeof value === "number") return isFinite(value) ? value : 0;
  const cleaned = value.trim().replace(/\s/g, "").replace(/,/g, ".");
  if (!cleaned || isNaN(Number(cleaned))) return 0;
  const num = Number(cleaned);
  return isFinite(num) ? num : 0;
};

export function Panel({
  title,
  children,
  className = "",
  collapsible = false,
  defaultCollapsed = false,
}: {
  title: React.ReactNode;
  children: ReactNode;
  className?: string;
  /** Show a toggle in the header that hides/shows the panel body. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div className={`bg-white border border-slate-300 rounded ${className}`}>
      <div
        className={`relative text-center py-1 font-semibold text-slate-700 border-b border-slate-300 ${collapsible ? "cursor-pointer select-none hover:bg-slate-100" : ""}`}
        style={{ background: "var(--color-erp-panel-header)" }}
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        title={collapsible ? (collapsed ? "توسيع" : "طي") : undefined}
      >
        {title}
        {collapsible && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
            className="absolute inset-y-0 left-2 flex items-center text-slate-600 hover:text-slate-900"
            aria-label={collapsed ? "توسيع" : "طي"}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        )}
      </div>
      {!collapsed && <div className="p-2">{children}</div>}
    </div>
  );
}

export function LabelText({ children }: { children: ReactNode }) {
  return <div className="text-xs text-slate-700 text-left pl-2 py-1">{children}</div>;
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2">
      <LabelText>{label}</LabelText>
      {children}
    </div>
  );
}

export function ErpInput({
  value,
  onChange,
  disabled,
  align = "right",
  highlight,
  className = "",
  type = "text",
}: {
  value: string | number;
  onChange: (v: string) => void;
  disabled?: boolean;
  align?: "right" | "left" | "center";
  highlight?: boolean;
  className?: string;
  type?: string;
}) {
  const isNumeric = type === "number";
  return (
    <input
      value={value}
      type={isNumeric ? "text" : type}
      inputMode={isNumeric ? "decimal" : undefined}
      onChange={(e) => {
        const v = e.target.value;
        if (isNumeric && v !== "" && !/^-?[\d]*[.,]?[\d]*$/.test(v)) return;
        onChange(v);
      }}
      disabled={disabled}
      className={`w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-700 text-${align} ${highlight ? "!bg-[var(--color-erp-highlight)]" : ""} ${className}`}
    />
  );
}

export function ErpSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50 text-right"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function ErpTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr style={{ background: "var(--color-erp-table-header)" }} className="text-slate-700">
            {headers.map((h) => (
              <th key={h} className="border border-slate-300 px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({
  value,
  onChange,
  disabled,
  align = "center",
  type = "text",
}: {
  value: string | number;
  onChange?: (v: string) => void;
  disabled?: boolean;
  align?: "right" | "left" | "center";
  type?: string;
}) {
  if (!onChange) {
    return <td className={`border border-slate-200 px-2 py-1 text-${align} bg-slate-50`}>{value}</td>;
  }
  const isNumeric = type === "number";
  return (
    <td className="border border-slate-200 p-0">
      <input
        value={value}
        type={isNumeric ? "text" : type}
        inputMode={isNumeric ? "decimal" : undefined}
        onChange={(e) => {
          const v = e.target.value;
          if (isNumeric && v !== "" && !/^-?[\d]*[.,]?[\d]*$/.test(v)) return;
          onChange(v);
        }}
        disabled={disabled}
        className={`w-full px-2 py-1 bg-transparent outline-none focus:bg-blue-50 disabled:text-slate-700 text-${align}`}
      />
    </td>
  );
}