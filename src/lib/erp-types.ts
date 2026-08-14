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
  /**
   * سعر بيع مكتوب يدوياً لهذا السطر، يتجاوز السعر المحسوب (التكلفة + نسبة الربح).
   * غير معرَّف = احسبه تلقائياً، ومسح الحقل يعيده إلى الحساب التلقائي.
   */
  salePrice?: number;
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

/**
 * طلب شراء — نفس تفاصيل أمر الشراء (نفس المورد، نفس البنود، نفس الاحتساب)
 * لكن بلا شاشة مصروفات: لا توجد مصروفات فعلية بعد، فالمستخدم يُدخل «سعر CBM»
 * و«نسبة المصاريف %» يدوياً ليقدّر التكلفة قبل الشراء. لذلك لا حقل `expenses`
 * هنا إطلاقاً — بدلاً منه حقلان مُدخلان يدوياً يقودان التوزيع.
 */
export type PurchaseRequest = {
  number: string;
  date: string;
  invoiceNo: string;
  supplierCode: string;
  currency: string;
  rate: number;
  containerNo: string;
  containerSize: string;
  distributionType: "cbm" | "percentage" | "average";
  /** سعر CBM المُدخل يدوياً بالدولار (تكلفة المصاريف لكل 1 CBM). */
  cbmPrice: number;
  /** نسبة المصاريف % المُدخلة يدوياً (تُطبَّق على قيمة الشراء). */
  expensePercentage: number;
  notes: string;
  rows: PORow[];
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
  /**
   * Name the program presents itself under — window title, browser tab, title
   * bar. Distinct from `companyName`, which labels who the data belongs to: a
   * reseller renames the product without renaming the customer.
   */
  appName?: string;
  /**
   * Custom launcher/tab icon as a `data:image/png;base64,...` URL, normalized to
   * 256x256 on upload (see src/lib/branding.ts). Stored inline rather than as a
   * file path so it travels with the settings row through the cloud backup and
   * lands on every device the account is restored to.
   */
  appIcon?: string;
  defaultCurrency: string;
  fiscalYear: string;
  language: "ar" | "en";
  priceTiers?: PriceTier[];
  currencies?: Currency[];
  /** Currency used to display the grand total of a purchase order. */
  masterCurrency?: string;
  /** Predefined expense types shown in the expenses dialog. */
  expenseTypes?: string[];
  /** Extended company/branch record (بيانات الشركة والفرع). Every field optional. */
  company?: CompanyProfile;
};

/**
 * The full company/branch card as it appears on the classic ERP screen. Every
 * field is optional on purpose: the program must stay usable with none of it
 * filled in, so nothing here is ever validated or required. Values are kept as
 * strings (even the numeric-looking ones) so leading zeros in codes, phone
 * numbers and postal codes survive a round-trip through storage.
 */
export type CompanyProfile = {
  // --- identity ---
  companyNo?: string;
  branchNo?: string;
  year?: string;
  companyNameEn?: string;
  branchName?: string;
  branchNameEn?: string;
  groupNo?: string;
  isMain?: boolean;
  onyxLiteLink?: boolean;
  // --- address & contact ---
  country?: string;
  governorateNo?: string;
  city?: string;
  regionNo?: string;
  district?: string;
  street?: string;
  buildingNo?: string;
  additionalNo?: string;
  postalCode?: string;
  shortAddress?: string;
  branchAddress?: string;
  branchAddressEn?: string;
  phone?: string;
  website?: string;
  gps?: string;
  longitude?: string;
  latitude?: string;
  // --- print header ---
  headerLine1?: string;
  headerLine2?: string;
  headerLine3?: string;
  specs?: string;
  headerLine1En?: string;
  headerLine2En?: string;
  headerLine3En?: string;
  specsEn?: string;
  // --- tax & legal ---
  taxAuthNo?: string;
  identityType?: string;
  identityNo?: string;
  taxSite?: string;
  taxAccountNan?: string;
  taxBranchNo?: string;
  taxGroupNo?: string;
  statisticalNo?: string;
  serial?: string;
  socialSecurityNo?: string;
  socialSecurityAgency?: string;
  activityCode?: string;
  activityName?: string;
  customersDebtLimit?: string;
  posName?: string;
  suspendDate?: string;
  suspendReason?: string;
  // --- free codes ---
  version?: string;
  code?: string;
  // --- audit stamps, maintained by the program (never typed by hand) ---
  createdAt?: string;
  createdBy?: string;
  createdDevice?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedDevice?: string;
  printCount?: number;
  editCount?: number;
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