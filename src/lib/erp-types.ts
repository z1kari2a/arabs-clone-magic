export type Supplier = {
  code: string;
  name: string;
  country: string;
  city: string;
  phone: string;
  email: string;
  currency: string;
  notes: string;
  active: boolean;
};

export type ItemUnit = {
  name: string;
  pack: number;
  lastPrice: number;
};

export type Item = {
  code: string; // model
  name: string;
  barcode: string;
  units: ItemUnit[];
  cbmPerCarton: number;
  /** Landed cost of one carton in USD (purchase cost + allocated expenses), from the last approved PO. */
  lastCost: number;
  /** Currency code the item is priced in (defaults to settings.defaultCurrency). */
  currency?: string;
  /** Pinned exchange rate captured at last purchase (same base as settings.currencies[].rate). */
  rate?: number;
};

export type PORow = {
  id: number;
  model: string;
  name: string;
  unit: string;
  pack: number;
  qty: number;
  price: number;
  cbm: number; // per carton
  /** Currency of `price`. Defaults to invoice currency when omitted. */
  currency?: string;
  /** Exchange rate of the row currency (same base as settings.currencies[].rate). */
  rate?: number;
};

export type Expense = {
  id: number;
  type: string;
  note: string;
  currency: string;
  amount: number;
  rate: number; // units of `currency` per 1 USD — expenses always convert straight to USD (amount / rate), never to invoice currency
  accountNo?: string;
  analyticAccount?: string;
  centerNo?: string;
  attached?: boolean;
  invoiceNo?: string;
  invoiceDate?: string;
  branch?: string;
};

export type PurchaseOrder = {
  number: string;
  date: string;
  invoiceNo: string;
  supplierCode: string;
  currency: string;
  rate: number;
  containerNo: string;
  containerSize: string;
  distributionType: "cbm" | "percentage" | "average";
  /** Manual override for "نسبة المصروفات %". Defaults to (totalExpenses/totalPurchase)*100 when unset. */
  expensePercentage?: number;
  notes: string;
  rows: PORow[];
  expenses: Expense[];
  approved: boolean;
};

export type User = {
  id: string;
  username: string;
  fullName: string;
  role: "admin" | "user" | "viewer";
  active: boolean;
  pending?: boolean;
};

export type Role = "admin" | "user" | "viewer";

export type AuditEntry = {
  id: number;
  user_email: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  before_data: unknown;
  after_data: unknown;
  created_at: string;
};

export type Settings = {
  companyName: string;
  defaultCurrency: string;
  fiscalYear: string;
  language: "ar" | "en";
  priceTiers?: PriceTier[];
  currencies?: Currency[];
  /** Currency used to display the grand total of a purchase order. */
  masterCurrency?: string;
  /** Predefined expense types shown in the expenses dialog. */
  expenseTypes?: string[];
};

export type Currency = {
  code: string; // YER, SAR, CNY, USD...
  name: string; // ريال, يوان...
  rate: number; // مقابل العملة الأساسية (الدولار الأمريكي)
};

export type PriceTier = {
  id: string;
  name: string;
  extraPct: number;   // % added on top of avg cost (logistics, taxes for destination)
  profitPct: number;  // % profit margin applied on top of tier cost
};