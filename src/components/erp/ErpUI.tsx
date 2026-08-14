import { useState, useRef, useEffect, type ReactNode, type FocusEvent, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export const fmt = (n: number, d = 2) =>
  (isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
export const fmtInt = (n: number) => (isFinite(n) ? n : 0).toLocaleString("en-US");

/**
 * Show a COMPUTED number with as many decimals as it actually has, capped at
 * `max` — 6 → "6", 6.5 → "6.5", 0.041666… → "0.0417". Unlike `fmt` it never
 * pads with trailing zeros, so a whole number reads as a whole number.
 */
export const fmtAuto = (n: number, max = 4) => {
  const v = isFinite(n) ? n : 0;
  const rounded = Number(v.toFixed(max));
  const decimals = (String(rounded).split(".")[1] ?? "").length;
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

/** Parse a decimal number written with either `.` or `,` as decimal separator. */
export const parseDecimal = (value: string | number): number => {
  if (typeof value === "number") return isFinite(value) ? value : 0;
  // Normalize Arabic-Indic digits (٠-٩ and ۰-۹) to Latin — so users can type
  // in any keyboard layout / direction.
  let normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    // `٬` (U+066C) is the Arabic THOUSANDS separator by definition — never a
    // decimal point, so it always just goes away.
    .replace(/\u066C/g, "");
  // A `.` already marks the decimal point (e.g. a formatted value like
  // "2,680.45" fed back into an input) — any `,`/`،`/`٫` left is THOUSANDS
  // grouping, not a second decimal separator. Turning it into a dot produced
  // "2.680.45" → NaN → 0, silently zeroing whatever the user typed.
  if (normalized.includes(".")) {
    normalized = normalized.replace(/[،,\u066B]/g, "");
  } else {
    // No `.` — the LAST comma variant is the decimal separator the user typed;
    // anything before it is thousands grouping.
    const lastSep = Math.max(
      normalized.lastIndexOf(","),
      normalized.lastIndexOf("،"),
      normalized.lastIndexOf("\u066B"),
    );
    if (lastSep !== -1) {
      normalized =
        normalized.slice(0, lastSep).replace(/[،,\u066B]/g, "") +
        "." +
        normalized.slice(lastSep + 1).replace(/[،,\u066B]/g, "");
    }
  }
  const cleaned = normalized;
  if (!cleaned || isNaN(Number(cleaned))) return 0;
  const num = Number(cleaned);
  return isFinite(num) ? num : 0;
};

/**
 * Show a number the way it was written — decimals are OPTIONAL, never forced.
 * 1 stays "1", 1.5 stays "1.5", 0.06 stays "0.06". This used to append ".0" to
 * every whole number, so a typed "1" snapped back to "1.0" and the decimal part
 * could not be deleted once it appeared.
 */
export const formatDecimalDisplay = (value: string | number): string => {
  if (value === "" || value == null) return "";
  const n = typeof value === "number" ? value : parseDecimal(value);
  if (!isFinite(n)) return "";
  if (n === 0 && typeof value === "string" && value.trim() === "") return "";
  return String(n);
};

// Digits and separators only — no letters. Several separators are allowed so a
// grouped number ("2,680.45") can be typed or pasted; parseDecimal decides
// which one is the decimal point.
const NUMERIC_RE = /^-?[\d\u0660-\u0669\u06F0-\u06F9.,،\u066B\u066C\s]*$/;

/** Shared local-buffer hook so numeric inputs accept "," and don't lose caret while typing. */
export function useNumericBuffer(value: string | number, isNumeric: boolean) {
  const initial = () => {
    if (!isNumeric) return String(value ?? "");
    if (value === "" || value == null) return "";
    const n = typeof value === "number" ? value : parseDecimal(value);
    if (!n && typeof value === "string" && value.trim() === "") return "";
    return formatDecimalDisplay(n);
  };
  const [text, setText] = useState<string>(initial);
  const focused = useRef(false);
  useEffect(() => {
    if (!isNumeric) { setText(String(value ?? "")); return; }
    if (focused.current) return;
    const propNum = typeof value === "number" ? value : parseDecimal(String(value ?? ""));
    const curNum = parseDecimal(text);
    if (propNum !== curNum) setText(value === "" || value == null ? "" : formatDecimalDisplay(propNum));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return {
    text,
    setText,
    // Select the whole pre-filled value on focus so typing REPLACES it
    // instead of inserting into it (e.g. a field auto-filled with a long
    // decimal like "0.0018656716417910447" would otherwise silently turn a
    // typed "2" into "20.0018656716417910447").
    onFocus: (e: FocusEvent<HTMLInputElement>) => {
      focused.current = true;
      e.target.select();
    },
    onBlur: () => {
      focused.current = false;
      if (isNumeric && text !== "") {
        const n = parseDecimal(text);
        setText(formatDecimalDisplay(n));
      }
    },
  };
}

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

/**
 * `labelWidth` widens the label column for screens whose captions don't fit the
 * 110px default (the company card's "النص الأول للترويسة بالأجنبي" and friends).
 * Applied as an inline style because the width is a runtime value — a
 * `grid-cols-[${n}px_1fr]` class would never be emitted by Tailwind's scanner.
 */
export function FieldRow({
  label,
  children,
  labelWidth,
}: {
  label: string;
  children: ReactNode;
  labelWidth?: number;
}) {
  return (
    <div
      className="grid grid-cols-[110px_1fr] items-center gap-2"
      style={labelWidth ? { gridTemplateColumns: `${labelWidth}px 1fr` } : undefined}
    >
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
  placeholder,
}: {
  value: string | number;
  onChange: (v: string) => void;
  disabled?: boolean;
  align?: "right" | "left" | "center";
  highlight?: boolean;
  className?: string;
  type?: string;
  placeholder?: string;
}) {
  const isNumeric = type === "number" || typeof value === "number";
  const buf = useNumericBuffer(value, isNumeric);
  return (
    <input
      value={buf.text}
      type={isNumeric ? "text" : type}
      placeholder={placeholder}
      inputMode={isNumeric ? "decimal" : undefined}
      onFocus={buf.onFocus}
      onBlur={buf.onBlur}
      onChange={(e) => {
        const v = e.target.value;
        if (isNumeric && v !== "" && !NUMERIC_RE.test(v)) return;
        buf.setText(v);
        onChange(v);
      }}
      disabled={disabled}
      className={`w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:text-slate-700 text-${align} ${highlight ? "!bg-[var(--color-erp-highlight)]" : ""} ${className}`}
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
      className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white outline-none focus:border-slate-400 disabled:bg-slate-50 text-right"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/**
 * Spreadsheet-style navigation for any grid of cells: ↑/↓ (and Enter) jump to
 * the SAME column in the row above/below, keeping the caret in a cell instead of
 * making the user reach for the mouse or Tab through a whole row. Tab/Shift+Tab
 * keep their native left/right behaviour, and ↑/↓ inside a <select> stay native
 * (they change the selected option) — only Enter moves out of one.
 *
 * Attached at the table level and driven off the DOM, so every editable cell —
 * including the raw <input>/<select> cells screens render themselves — gets it
 * without touching a single call site.
 */
export function gridKeyNav(e: KeyboardEvent<HTMLElement>) {
  const el = e.target as HTMLElement | null;
  const editable =
    el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
  if (!editable) return;

  let dir = 0;
  if (e.key === "ArrowDown" || e.key === "Enter") dir = 1;
  else if (e.key === "ArrowUp") dir = -1;
  else return;
  if (el instanceof HTMLSelectElement && e.key !== "Enter") return; // ↑/↓ pick options
  if (e.altKey || e.ctrlKey || e.metaKey) return;

  const td = el.closest("td");
  const tr = td?.closest("tr");
  const body = tr?.parentElement;
  if (!td || !tr || !body) return;

  const col = Array.prototype.indexOf.call(tr.children, td);
  const rows = Array.prototype.slice.call(body.children) as HTMLElement[];
  // Skip over rows whose cell in this column has nothing focusable (a spacer
  // row, or a column that is computed-only on that line).
  for (let i = rows.indexOf(tr) + dir; i >= 0 && i < rows.length; i += dir) {
    const target = rows[i].children[col] as HTMLElement | undefined;
    const next = target?.querySelector<HTMLElement>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    );
    if (!next) continue;
    e.preventDefault();
    next.focus();
    if (next instanceof HTMLInputElement && next.type !== "checkbox") next.select();
    return;
  }
}

/**
 * `widths` sizes the columns like the merchant's spreadsheet: narrow, fixed
 * columns whose header text WRAPS onto a second line instead of stretching the
 * column to fit one long line. Pass a CSS width per column (same order as
 * `headers`); omit it to keep the auto-sized layout.
 */
export function ErpTable({
  headers,
  children,
  widths,
}: {
  headers: string[];
  children: ReactNode;
  widths?: (string | undefined)[];
}) {
  return (
    <div className="overflow-x-auto">
      {/* جدول بأعرض مُصرَّحة: `w-max` حتى يأخذ كل عمود عرضه المكتوب بالضبط
          مهما كان عرض النافذة. مع `w-full` يوزّع المتصفّح الفائض على الأعمدة
          فيتضخّم عمودٌ طُلب له 250px إلى 290px، ومع `w-auto` يضغطها إذا ضاقت
          النافذة فينزل إلى 240px. عند ضيق النافذة يظهر شريط تمرير أفقي بدل
          العبث بالأعرض. الجداول التي لا تُمرّر أعرضاً تبقى ممتدّة كما كانت. */}
      <table
        onKeyDown={gridKeyNav}
        className={`erp-grid border-collapse text-[12px] ${widths ? "table-fixed w-max" : "w-full"}`}
      >
        {widths && (
          <colgroup>
            {headers.map((h, i) => (
              <col key={h + i} style={widths[i] ? { width: widths[i] } : undefined} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr style={{ background: "var(--color-erp-table-header)" }} className="text-slate-700">
            {headers.map((h, i) => (
              <th
                key={h + i}
                className={`border border-slate-300 px-1 py-1 font-semibold leading-tight ${widths ? "whitespace-normal break-words" : "whitespace-nowrap px-2 py-1.5"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * خانة «سعر البيع» — قابلة للكتابة في أمر الشراء وطلب الشراء معاً.
 *
 * القيمة المعروضة هي السعر الفعلي: ما كتبه المستخدم على السطر إن وُجد، وإلا
 * المحسوب (التكلفة المعتمدة + نسبة الربح). مسح الخانة يعيدها إلى الحساب
 * التلقائي فوراً — ولهذا لا تُستعمل `Cell` هنا: تلك تحتفظ بنصّها بعد المسح
 * فتبقى الخانة فارغة بصرياً رغم عودة القيمة. هنا يُعرض ما يكتبه المستخدم
 * أثناء الكتابة فقط، وبعد الخروج من الحقل يُعرض السعر الفعلي دائماً.
 */
export function SaleCell({
  value,
  overridden,
  disabled,
  onChange,
  decimals = 1,
}: {
  value: number;
  overridden: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  /** عدد الخانات العشرية المعروضة حين لا يكون المستخدم يكتب. */
  decimals?: number;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const factor = 10 ** decimals;
  const shown = typing ?? String(Math.round((isFinite(value) ? value : 0) * factor) / factor);
  // السعر المكتوب يدوياً يُميَّز بتظليل رمادي أغمق وخط تحته لا بلون —
  // تبقى المعلومة ظاهرة والجدول بلون النظام.
  return (
    <td className={`border border-slate-200 p-0 ${overridden ? "bg-slate-200" : "bg-slate-50"}`}>
      <input
        value={shown}
        inputMode="decimal"
        disabled={disabled}
        title={overridden ? "سعر مكتوب يدوياً — امسح الخانة ليعود إلى الحساب التلقائي" : "محسوب تلقائياً — اكتب سعراً لتثبيته"}
        onFocus={(e) => { setTyping(shown); e.target.select(); }}
        onBlur={() => setTyping(null)}
        onChange={(e) => {
          const v = e.target.value;
          if (v !== "" && !NUMERIC_RE.test(v)) return;
          setTyping(v);
          onChange(v);
        }}
        className={`w-full px-2 py-1 bg-transparent outline-none text-right font-bold text-slate-800 disabled:text-slate-700 ${overridden ? "underline decoration-slate-400 underline-offset-2" : ""}`}
      />
    </td>
  );
}

export function Cell({
  value,
  onChange,
  disabled,
  align = "center",
  type = "text",
  inputClass = "",
}: {
  value: string | number;
  onChange?: (v: string) => void;
  disabled?: boolean;
  align?: "right" | "left" | "center";
  type?: string;
  /** تنسيق إضافي لنصّ الخانة — يُستعمل لإبراز أعمدة مثل «اسم الصنف». */
  inputClass?: string;
}) {
  if (!onChange) {
    return <td className={`border border-slate-200 px-2 py-1 text-${align} bg-slate-50 ${inputClass}`}>{value}</td>;
  }
  return <CellInput value={value} onChange={onChange} disabled={disabled} align={align} type={type} inputClass={inputClass} />;
}

function CellInput({
  value, onChange, disabled, align, type, inputClass,
}: {
  value: string | number;
  onChange: (v: string) => void;
  disabled?: boolean;
  align: "right" | "left" | "center";
  type: string;
  inputClass: string;
}) {
  const isNumeric = type === "number" || typeof value === "number";
  const buf = useNumericBuffer(value, isNumeric);
  return (
    <td className="border border-slate-200 p-0">
      <input
        value={buf.text}
        type={isNumeric ? "text" : type}
        inputMode={isNumeric ? "decimal" : undefined}
        onFocus={buf.onFocus}
        onBlur={buf.onBlur}
        onChange={(e) => {
          const v = e.target.value;
          if (isNumeric && v !== "" && !NUMERIC_RE.test(v)) return;
          buf.setText(v);
          onChange(v);
        }}
        disabled={disabled}
        className={`w-full px-2 py-1 bg-transparent outline-none disabled:text-slate-700 text-${align} ${inputClass}`}
      />
    </td>
  );
}