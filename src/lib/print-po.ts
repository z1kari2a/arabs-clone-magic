// طباعة أمر الشراء كمستند مستقل — لا لقطة من الشاشة.
//
// `window.print()` كان يطبع الواجهة كما هي: شريط الأوامر، الأزرار، القوائم
// المنسدلة، والخانات الفارغة، وتنقطع الجداول بين الصفحات بلا رؤوس. هنا نبني
// مستند HTML خاصاً بالورق (A4 أفقي) يحوي الفاتورة كاملة بحساباتها ومجاميعها،
// ونطبعه من إطار مخفي حتى لا يتأثر بأي شيء في الصفحة.

import type { PurchaseOrder, PurchaseRequest, Supplier, PriceTier, PORow } from "./erp-types";
import { computePO, computePR, cartonsOf } from "./erp-store";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const n = (v: number, d = 2) =>
  (isFinite(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** رقم بأقل عدد ممكن من الخانات العشرية (6 → "6"، 0.0417 → "0.0417"). */
const auto = (v: number, max = 4) => {
  const r = Number((isFinite(v) ? v : 0).toFixed(max));
  const dec = (String(r).split(".")[1] ?? "").length;
  return r.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

/**
 * تنسيق المستند المطبوع — نسخة واحدة تستخدمها كل المستندات (أمر الشراء، طلب
 * الشراء، التسعيرات) حتى تخرج من الطابعة بشكل واحد ولا تتفرّع الأنماط.
 */
const DOC_CSS = `
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: "Cairo", "Segoe UI", Tahoma, sans-serif; font-size: 8.5pt; color: #111; margin: 0; }

  /* ترويسة تتكرّر أعلى كل صفحة مطبوعة */
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #1e5a8e; padding-bottom: 5px; margin-bottom: 7px; }
  .co { font-size: 15pt; font-weight: 800; color: #1e5a8e; }
  .doc { text-align: left; }
  .doc .t { font-size: 12pt; font-weight: 700; }
  .doc .num { font-size: 10pt; font-weight: 700; color: #1e5a8e; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 9px; font-size: 8pt; font-weight: 700; }
  .ok { background: #dcfce7; color: #166534; }
  .draft { background: #fef3c7; color: #92400e; }

  .sec { background: #eaf2fa; border: 1px solid #b6c6d6; border-right: 3px solid #1e5a8e;
         font-weight: 700; padding: 3px 7px; margin: 8px 0 4px; font-size: 9pt; }
  .info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid #cbd5e1; }
  .cell { display: flex; border-bottom: 1px solid #e2e8f0; border-left: 1px solid #e2e8f0; padding: 2px 6px; }
  .cell .lbl { color: #64748b; min-width: 78px; }
  .cell .val { font-weight: 600; }

  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.grid th { background: #eaf2fa; border: 1px solid #94a3b8; padding: 3px 2px;
                  font-size: 7.5pt; font-weight: 700; word-wrap: break-word; }
  table.grid td { border: 1px solid #cbd5e1; padding: 2px 3px; font-size: 8pt; }
  table.grid tfoot td { background: #f1f5f9; font-weight: 700; border-top: 2px solid #94a3b8; }
  thead { display: table-header-group; }   /* رأس الجدول يتكرّر في كل صفحة */
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; }
  .c { text-align: center; } .r { text-align: right; } .l { text-align: left; }
  .b { font-weight: 700; } .g { color: #15803d; } .nm { white-space: normal; }
  .empty { text-align: center; color: #94a3b8; padding: 8px; font-style: italic; }

  .stats { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; margin-top: 6px; }
  .stat { border: 1px solid #cbd5e1; border-radius: 3px; padding: 4px; text-align: center; }
  .stat .sl { font-size: 7pt; color: #64748b; }
  .stat .sv { font-size: 10pt; font-weight: 800; color: #0f172a; }
  .stat small { font-size: 6.5pt; color: #94a3b8; font-weight: 500; }
  .total { margin-top: 5px; border: 2px solid #15803d; background: #f0fdf4; border-radius: 4px;
           padding: 5px 10px; display: flex; justify-content: space-between; align-items: center; }
  .total .v { font-size: 15pt; font-weight: 900; color: #15803d; }

  .notes { margin-top: 7px; border: 1px solid #cbd5e1; padding: 4px 7px; min-height: 26px; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin-top: 16px; text-align: center; }
  .sign div { border-top: 1px solid #64748b; padding-top: 3px; font-size: 8pt; }
  .foot { margin-top: 8px; border-top: 1px solid #cbd5e1; padding-top: 3px;
          display: flex; justify-content: space-between; color: #94a3b8; font-size: 7pt; }
  .break { page-break-before: always; }`;

const info = (label: string, value: string) =>
  `<div class="cell"><span class="lbl">${esc(label)}</span><span class="val">${esc(value)}</span></div>`;

const stat = (label: string, value: string, unit = "") =>
  `<div class="stat"><div class="sl">${esc(label)}</div><div class="sv">${esc(value)} <small>${esc(unit)}</small></div></div>`;

const distributionLabel = (t: "cbm" | "percentage" | "average") =>
  t === "cbm" ? "حسب تكلفة CBM" : t === "percentage" ? "حسب التكلفة المئوية" : "حسب متوسط التكلفة";

/** الأسطر الحقيقية فقط، مع الاحتفاظ بفهرسها الأصلي للبحث في rowMetrics. */
const realRowsOf = (rows: PORow[]) =>
  rows.map((r, i) => ({ r, i })).filter(({ r }) => r.model || r.name || (r.qty || 0) > 0);

/** ما تحتاجه جداول الطباعة من نتيجة الاحتساب — يصدُق على computePO و computePR معاً. */
type PrintMetrics = {
  rowMetrics: { lineInvoiceTotal: number; purchaseCost: number; cbmCost: number; pctCost: number;
                avgCost: number; allocatedExpPerCarton: number; selectedCost: number }[];
  totalQty: number; totalInvoiceAmount: number; totalPurchase: number;
  totalCBM: number; totalCost: number;
};

/** جدول البنود — نفس الأعمدة في أمر الشراء وطلب الشراء. */
function itemsTableHTML(
  rows: { r: PORow; i: number }[],
  m: PrintMetrics,
  currency: string,
  markupPct: number,
): string {
  const body = rows
    .map(({ r, i }, idx) => {
      const rm = m.rowMetrics[i];
      // سعر بيع كتبه المستخدم على السطر يتقدّم على المحسوب — وإلا التكلفة + الربح.
      const sale = r.salePrice ?? (rm?.selectedCost ?? 0) * (1 + markupPct / 100);
      return `<tr>
        <td class="c">${idx + 1}</td>
        <td class="c">${esc(r.model)}</td>
        <td class="r nm">${esc(r.name)}</td>
        <td class="c">${esc(r.unit)}</td>
        <td class="l">${auto(r.pack)}</td>
        <td class="l">${auto(r.qty)}</td>
        <td class="c">${esc(r.currency ?? currency)}</td>
        <td class="l">${auto(r.price)}</td>
        <td class="l b">${auto(rm?.lineInvoiceTotal ?? 0)}</td>
        <td class="l">${n(rm?.purchaseCost ?? 0, 1)}</td>
        <td class="l">${auto(r.cbm)}</td>
        <td class="l">${auto(cartonsOf(r) * (r.cbm || 0))}</td>
        <td class="l">${n(rm?.cbmCost ?? 0, 1)}</td>
        <td class="l">${n(rm?.pctCost ?? 0, 1)}</td>
        <td class="l">${n(rm?.avgCost ?? 0, 1)}</td>
        <td class="l">${n(rm?.allocatedExpPerCarton ?? 0, 5)}</td>
        <td class="l b g">${n(sale, 2)}</td>
      </tr>`;
    })
    .join("");

  return `
  <table class="grid">
    <thead>
      <tr>
        <th style="width:3%">م</th><th style="width:6%">الموديل</th><th style="width:14%">اسم الصنف</th>
        <th style="width:5%">الوحدة</th><th style="width:5%">العبوة</th><th style="width:5%">الكمية</th>
        <th style="width:5%">العملة</th><th style="width:6%">سعر الشراء</th>
        <th style="width:8%">اجمالي امر الشراء</th><th style="width:7%">تكلفة الشراء$</th>
        <th style="width:6%">CBM الكرتون</th><th style="width:6%">إجمالي CBM</th>
        <th style="width:6%">تكلفة CBM $</th><th style="width:6%">التكلفة المئوية $</th>
        <th style="width:6%">متوسط التكلفة $</th><th style="width:6%">خرج للكرتون$</th>
        <th style="width:7%">سعر البيع (+${esc(String(markupPct))}%)</th>
      </tr>
    </thead>
    <tbody>${body || `<tr><td colspan="17" class="c empty">لا توجد بنود</td></tr>`}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" class="r">الإجمالي</td>
        <td class="l">${auto(m.totalQty)}</td>
        <td colspan="2" class="l">${auto(m.totalInvoiceAmount)} ${esc(currency)}</td>
        <td class="l">${n(m.totalPurchase, 1)}</td>
        <td></td>
        <td class="l">${auto(m.totalCBM)}</td>
        <td colspan="5" class="r">إجمالي التكلفة: ${n(m.totalCost, 2)} USD</td>
      </tr>
    </tfoot>
  </table>`;
}

/** جدول «التسعيرات حسب الوجهات» الملحق بالمستند (بالدولار). */
function tiersSectionHTML(
  rows: { r: PORow; i: number }[],
  m: PrintMetrics,
  priceTiers: PriceTier[],
): string {
  if (!priceTiers.length || !rows.length) return "";
  const body = rows
    .map(({ r, i }, idx) => {
      const cost = m.rowMetrics[i]?.selectedCost ?? 0;
      const cells = priceTiers
        .map((t) => {
          const tc = cost * (1 + (t.extraPct || 0) / 100);
          return `<td class="l">${n(tc, 2)}</td><td class="l b g">${n(tc * (1 + (t.profitPct || 0) / 100), 2)}</td>`;
        })
        .join("");
      return `<tr><td class="c">${idx + 1}</td><td class="c">${esc(r.model)}</td><td class="r nm">${esc(r.name)}</td><td class="l b">${n(cost, 2)}</td>${cells}</tr>`;
    })
    .join("");
  return `<div class="sec">التسعيرات حسب الوجهات (USD)</div>
     <table class="grid">
       <thead><tr>
         <th style="width:4%">م</th><th style="width:10%">الموديل</th><th style="width:22%">اسم الصنف</th>
         <th style="width:12%">التكلفة المعتمدة</th>
         ${priceTiers.map((t) => `<th>تكلفة ${esc(t.name)}</th><th>بيع ${esc(t.name)}</th>`).join("")}
       </tr></thead>
       <tbody>${body}</tbody>
     </table>`;
}

export type PrintOptions = {
  po: PurchaseOrder;
  supplier?: Supplier;
  companyName: string;
  markupPct: number;
  priceTiers: PriceTier[];
  /** سعر صرف عملة العرض مقابل الدولار (units per 1 USD). */
  rateOfCode: (code: string) => number;
  masterCurrency: string;
};

export function buildPurchaseOrderHTML(o: PrintOptions): string {
  const { po, supplier, companyName, markupPct, priceTiers, rateOfCode, masterCurrency } = o;
  const m = computePO(po);
  const rows = realRowsOf(po.rows);

  const printedAt = new Date().toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
  const masterRate = masterCurrency === "USD" ? 1 : rateOfCode(masterCurrency) || 1;
  const distLabel = distributionLabel(po.distributionType);

  // ---- بنود الفاتورة ----
  const itemsTable = itemsTableHTML(rows, m, po.currency, markupPct);

  // ---- المصروفات ----
  const expRows = po.expenses
    .map((e, i) => {
      const rate = e.rate || rateOfCode(e.currency) || 0;
      return `<tr>
        <td class="c">${i + 1}</td>
        <td class="r">${esc(e.type || "—")}</td>
        <td class="r">${esc(e.note || "")}</td>
        <td class="c">${esc(e.currency)}</td>
        <td class="l">${auto(e.amount)}</td>
        <td class="l">${n(rate, 4)}</td>
        <td class="l b">${n(rate > 0 ? e.amount / rate : 0, 2)}</td>
      </tr>`;
    })
    .join("");

  const expensesTable = po.expenses.length
    ? `<table class="grid">
        <thead><tr>
          <th style="width:5%">م</th><th style="width:22%">اسم المصروف</th><th style="width:33%">البيان</th>
          <th style="width:10%">العملة</th><th style="width:10%">المبلغ</th>
          <th style="width:10%">سعر الصرف</th><th style="width:10%">بالدولار</th>
        </tr></thead>
        <tbody>${expRows}</tbody>
        <tfoot><tr><td colspan="6" class="r">إجمالي المصروفات</td><td class="l b">${n(m.totalExpenses, 2)} USD</td></tr></tfoot>
      </table>`
    : `<div class="empty">لا توجد مصروفات مسجّلة على هذه الفاتورة</div>`;

  // ---- التسعيرات حسب الوجهات ----
  const tiersTable = tiersSectionHTML(rows, m, priceTiers);

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>أمر شراء ${esc(po.number)}</title>
<style>${DOC_CSS}</style></head>
<body>

<div class="head">
  <div>
    <div class="co">${esc(companyName)}</div>
    <div style="color:#64748b">${esc(supplier?.name ? `المورد: ${supplier.name}` : "")}</div>
  </div>
  <div class="doc">
    <div class="t">أمر شراء / احتساب التكلفة</div>
    <div class="num">${esc(po.number)}</div>
    <div><span class="badge ${po.approved ? "ok" : "draft"}">${po.approved ? "معتمد" : "مسودة"}</span></div>
  </div>
</div>

<div class="sec">بيانات المورد وأمر الشراء</div>
<div class="info">
  ${info("المورد", supplier?.name ?? "—")}
  ${info("كود المورد", supplier?.code ?? po.supplierCode ?? "—")}
  ${info("الدولة", supplier?.country ?? "—")}
  ${info("المدينة", supplier?.city ?? "—")}
  ${info("الهاتف", supplier?.phone ?? "—")}
  ${info("البريد", supplier?.email ?? "—")}
  ${info("رقم الفاتورة", po.invoiceNo || po.number)}
  ${info("التاريخ", po.date)}
  ${info("العملة", po.currency)}
  ${info("سعر الصرف", `1 USD = ${n(po.rate || 1, 4)} ${po.currency}`)}
  ${info("رقم الحاوية", po.containerNo || "—")}
  ${info("حجم الحاوية", po.containerSize || "—")}
  ${info("طريقة التوزيع", distLabel)}
  ${info("نسبة المصاريف", `${n(m.pctRate, 2)} %`)}
  ${info("نسبة الربح", `${n(markupPct, 2)} %`)}
  ${info("سعر CBM", `${n(m.cbmPrice, 2)} USD`)}
</div>

<div class="sec">بنود الفاتورة (${rows.length})</div>
${itemsTable}

<div class="sec">المصروفات (${po.expenses.length})</div>
${expensesTable}

<div class="sec">احتساب التكلفة النهائية</div>
<div class="stats">
  ${stat("عدد الأصناف", String(m.totalItems), "صنف")}
  ${stat("إجمالي الكمية", auto(m.totalQty))}
  ${stat("إجمالي أمر الشراء", auto(m.totalInvoiceAmount), po.currency)}
  ${stat("إجمالي الشراء", n(m.totalPurchase), "USD")}
  ${stat("إجمالي CBM", auto(m.totalCBM), "CBM")}
  ${stat("سعر CBM", n(m.cbmPrice), "USD")}
  ${stat("إجمالي المصروفات", n(m.totalExpenses), "USD")}
  ${stat("إجمالي التكلفة", n(m.totalCost), "USD")}
</div>
<div class="total">
  <span>الإجمالي النهائي بعملة العرض (${esc(masterCurrency)})</span>
  <span class="v">${n(m.totalCost * masterRate)} <small style="font-size:9pt">${esc(masterCurrency)}</small></span>
</div>

${po.notes ? `<div class="sec">الملاحظات</div><div class="notes">${esc(po.notes)}</div>` : ""}

${tiersTable}

<div class="sign">
  <div>المُعِدّ</div><div>المحاسب</div><div>المدير</div>
</div>

<div class="foot">
  <span>${esc(companyName)} — أمر شراء ${esc(po.number)}</span>
  <span>طُبع في ${esc(printedAt)}</span>
</div>

</body></html>`;
}

export type RequestPrintOptions = {
  pr: PurchaseRequest;
  supplier?: Supplier;
  companyName: string;
  markupPct: number;
  priceTiers: PriceTier[];
  rateOfCode: (code: string) => number;
  masterCurrency: string;
};

/**
 * مستند «طلب الشراء» — نفس بنود وأعمدة أمر الشراء، بلا قسم المصروفات: سعر CBM
 * ونسبة المصاريف مُدخلان يدوياً ويظهران في الترويسة، والمصاريف المعروضة تقديرية
 * (ما وزّعته الأسطر فعلاً على الأساس المختار).
 */
export function buildPurchaseRequestHTML(o: RequestPrintOptions): string {
  const { pr, supplier, companyName, markupPct, priceTiers, rateOfCode, masterCurrency } = o;
  const m = computePR(pr);
  const rows = realRowsOf(pr.rows);
  const printedAt = new Date().toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
  const masterRate = masterCurrency === "USD" ? 1 : rateOfCode(masterCurrency) || 1;

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>طلب شراء ${esc(pr.number)}</title>
<style>${DOC_CSS}</style></head>
<body>

<div class="head">
  <div>
    <div class="co">${esc(companyName)}</div>
    <div style="color:#64748b">${esc(supplier?.name ? `المورد: ${supplier.name}` : "")}</div>
  </div>
  <div class="doc">
    <div class="t">طلب شراء / تقدير التكلفة</div>
    <div class="num">${esc(pr.number)}</div>
    <div><span class="badge ${pr.approved ? "ok" : "draft"}">${pr.approved ? "معتمد" : "مسودة"}</span></div>
  </div>
</div>

<div class="sec">بيانات المورد وطلب الشراء</div>
<div class="info">
  ${info("المورد", supplier?.name ?? "—")}
  ${info("كود المورد", supplier?.code ?? pr.supplierCode ?? "—")}
  ${info("الدولة", supplier?.country ?? "—")}
  ${info("المدينة", supplier?.city ?? "—")}
  ${info("الهاتف", supplier?.phone ?? "—")}
  ${info("البريد", supplier?.email ?? "—")}
  ${info("رقم الطلب", pr.invoiceNo || pr.number)}
  ${info("التاريخ", pr.date)}
  ${info("العملة", pr.currency)}
  ${info("سعر الصرف", `1 USD = ${n(pr.rate || 1, 4)} ${pr.currency}`)}
  ${info("رقم الحاوية", pr.containerNo || "—")}
  ${info("حجم الحاوية", pr.containerSize || "—")}
  ${info("طريقة التوزيع", distributionLabel(pr.distributionType))}
  ${info("نسبة المصاريف (يدوي)", `${n(m.pctRate, 2)} %`)}
  ${info("نسبة الربح", `${n(markupPct, 2)} %`)}
  ${info("سعر CBM (يدوي)", `${n(m.cbmPrice, 2)} USD`)}
</div>

<div class="sec">بنود الطلب (${rows.length})</div>
${itemsTableHTML(rows, m, pr.currency, markupPct)}

<div class="sec">تقدير التكلفة</div>
<div class="stats">
  ${stat("عدد الأصناف", String(m.totalItems), "صنف")}
  ${stat("إجمالي الكمية", auto(m.totalQty))}
  ${stat("إجمالي الطلب", auto(m.totalInvoiceAmount), pr.currency)}
  ${stat("إجمالي الشراء", n(m.totalPurchase), "USD")}
  ${stat("إجمالي CBM", auto(m.totalCBM), "CBM")}
  ${stat("سعر CBM (يدوي)", n(m.cbmPrice), "USD")}
  ${stat("مصاريف تقديرية", n(m.totalExpenses), "USD")}
  ${stat("إجمالي التكلفة", n(m.totalCost), "USD")}
</div>
<div class="total">
  <span>الإجمالي التقديري بعملة العرض (${esc(masterCurrency)})</span>
  <span class="v">${n(m.totalCost * masterRate)} <small style="font-size:9pt">${esc(masterCurrency)}</small></span>
</div>

${pr.notes ? `<div class="sec">الملاحظات</div><div class="notes">${esc(pr.notes)}</div>` : ""}

${tiersSectionHTML(rows, m, priceTiers)}

<div class="sign">
  <div>مُقدِّم الطلب</div><div>المراجع</div><div>المدير</div>
</div>

<div class="foot">
  <span>${esc(companyName)} — طلب شراء ${esc(pr.number)}</span>
  <span>طُبع في ${esc(printedAt)}</span>
</div>

</body></html>`;
}

export type TiersPrintOptions = {
  po: PurchaseOrder;
  supplier?: Supplier;
  companyName: string;
  priceTiers: PriceTier[];
  /** عملة العرض ورقم صرفها مقابل الدولار (units per 1 USD). */
  displayCurrency: string;
  displayRate: number;
};

/** مستند «التسعيرات حسب الوجهات» وحده — الشاشة المنفصلة تطبع هذا فقط. */
export function buildPriceTiersHTML(o: TiersPrintOptions): string {
  const { po, supplier, companyName, priceTiers, displayCurrency, displayRate } = o;
  const m = computePO(po);
  const rows = po.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.model || r.name);
  const printedAt = new Date().toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });

  const body = rows
    .map(({ r, i }, idx) => {
      const cost = (m.rowMetrics[i]?.selectedCost ?? 0) * displayRate;
      const cells = priceTiers
        .map((t) => {
          const tc = cost * (1 + (t.extraPct || 0) / 100);
          return `<td class="l">${n(tc, 2)}</td><td class="l b g">${n(tc * (1 + (t.profitPct || 0) / 100), 2)}</td>`;
        })
        .join("");
      return `<tr><td class="c">${idx + 1}</td><td class="c">${esc(r.model)}</td><td class="r nm">${esc(r.name)}</td><td class="l b">${n(cost, 2)}</td>${cells}</tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>التسعيرات ${esc(po.number)}</title>
<style>${DOC_CSS}</style></head>
<body>

<div class="head">
  <div>
    <div class="co">${esc(companyName)}</div>
    <div style="color:#64748b">${esc(supplier?.name ? `المورد: ${supplier.name}` : "")}</div>
  </div>
  <div class="doc">
    <div class="t">التسعيرات حسب الوجهات</div>
    <div class="num">${esc(po.number)}</div>
  </div>
</div>

<div class="info">
  <div class="cell"><span class="lbl">الفاتورة</span><span class="val">${esc(po.number)}</span></div>
  <div class="cell"><span class="lbl">التاريخ</span><span class="val">${esc(po.date)}</span></div>
  <div class="cell"><span class="lbl">عملة العرض</span><span class="val">${esc(displayCurrency)}</span></div>
  <div class="cell"><span class="lbl">سعر الصرف</span><span class="val">1 USD = ${n(displayRate, 4)} ${esc(displayCurrency)}</span></div>
</div>

<div class="sec">قواعد التسعير</div>
<table class="grid">
  <thead><tr><th style="width:34%">التسعيرة</th><th>نسبة إضافية على التكلفة %</th><th>نسبة الربح %</th></tr></thead>
  <tbody>${
    priceTiers
      .map((t) => `<tr><td class="r">${esc(t.name)}</td><td class="l">${n(t.extraPct || 0, 2)}</td><td class="l">${n(t.profitPct || 0, 2)}</td></tr>`)
      .join("") || `<tr><td colspan="3" class="c empty">لا توجد تسعيرات معرّفة</td></tr>`
  }</tbody>
</table>

<div class="sec">الأصناف (${rows.length}) — بعملة ${esc(displayCurrency)}</div>
<table class="grid">
  <thead><tr>
    <th style="width:4%">م</th><th style="width:10%">الموديل</th><th style="width:22%">اسم الصنف</th>
    <th style="width:12%">التكلفة المعتمدة</th>
    ${priceTiers.map((t) => `<th>تكلفة ${esc(t.name)}</th><th>بيع ${esc(t.name)}</th>`).join("")}
  </tr></thead>
  <tbody>${body || `<tr><td colspan="${4 + priceTiers.length * 2}" class="c empty">لا توجد أصناف</td></tr>`}</tbody>
</table>

<div class="foot">
  <span>${esc(companyName)} — تسعيرات الفاتورة ${esc(po.number)}</span>
  <span>طُبع في ${esc(printedAt)}</span>
</div>

</body></html>`;
}

/**
 * يطبع مستند HTML من إطار مخفي: الصفحة الأصلية لا تتأثر، ولا يعترضه مانع
 * النوافذ المنبثقة كما يحدث مع window.open.
 */
function printHTMLDocument(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:-10000px;bottom:0;width:1200px;height:900px;border:0;";
  document.body.appendChild(frame);

  const cleanup = () => {
    // بعد إغلاق صندوق الطباعة — مهلة قصيرة حتى لا يُحذف الإطار أثناء الطباعة.
    window.setTimeout(() => frame.remove(), 1000);
  };

  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return cleanup();
    win.onafterprint = cleanup;
    win.focus();
    win.print();
    // متصفحات لا تُطلق onafterprint — نظّف بعد مهلة على أي حال.
    window.setTimeout(cleanup, 60_000);
  };

  const doc = frame.contentDocument;
  if (!doc) return cleanup();
  doc.open();
  doc.write(html);
  doc.close();
}

export function printPurchaseOrder(o: PrintOptions): void {
  printHTMLDocument(buildPurchaseOrderHTML(o));
}

export function printPurchaseRequest(o: RequestPrintOptions): void {
  printHTMLDocument(buildPurchaseRequestHTML(o));
}

export function printPriceTiers(o: TiersPrintOptions): void {
  printHTMLDocument(buildPriceTiersHTML(o));
}
