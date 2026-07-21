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
  lastCost: number;
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
};

export type Expense = {
  id: number;
  type: string;
  note: string;
  currency: string;
  amount: number;
  rate: number; // to invoice currency
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
  distributionType: "cbm" | "value" | "qty";
  notes: string;
  rows: PORow[];
  expenses: Expense[];
  approved: boolean;
};

export type User = {
  username: string;
  fullName: string;
  role: "admin" | "user" | "viewer";
  active: boolean;
};

export type Settings = {
  companyName: string;
  defaultCurrency: string;
  fiscalYear: string;
  language: "ar" | "en";
};