// Appwrite schema mirroring the Supabase schema in supabase/migrations/*.sql,
// plus the mapping needed to sync it against the local SQLite store.
//
// ── How the local store actually looks ────────────────────────────────────────
// electron/db.cjs does NOT keep one SQLite table per business table. It keeps a
// key/value table `erp_tables(name, payload)` where each "logical table" is one
// JSON array blob (same shape the browser keeps in localStorage). So there is no
// per-row `synced` column to read. sync.js therefore maintains its own row-level
// sync state in `erp_sync_state` (see local-store.js), where `synced = 0` marks a
// record whose local content differs from what Appwrite last confirmed.
//
// ── Deviations from the Supabase schema, and why ──────────────────────────────
// 1. Natural keys instead of UUID foreign keys. Local records have no UUIDs;
//    they are keyed by supplier.code / item.code / purchase_order.number. Child
//    rows therefore reference the parent by `po_number`, not `po_id`.
// 2. UNIQUE(code)/UNIQUE(number) become composite UNIQUE(sync_scope, code).
//    Supabase's global uniqueness cannot hold once several devices share one
//    database — exactly the collision the erp_backups migration documents.
// 3. `purchase_orders.rows[]` / `expenses[]` are nested arrays locally; they are
//    exploded into the `po_rows` / `po_expenses` collections to match Supabase,
//    and reassembled on pull.
// 4. `distribution_type` stays a plain string, not an enum: the SQL comment says
//    'cbm/value/qty' but the shipped app (src/lib/erp-types.ts) writes
//    'cbm' | 'percentage' | 'average'. A string tolerates both.
// 5. `po_date` is a string(32), not datetime: the app stores a plain 'YYYY-MM-DD'
//    date which Appwrite's ISO-8601 datetime attribute rejects.
// 6. Supabase's DB-side machinery (RLS policies, triggers, audit_trigger,
//    set_updated_at, has_role) has no Appwrite equivalent. Appwrite supplies
//    $createdAt/$updatedAt itself, and access control lives in collection
//    permissions instead of row policies.

const str = (key, size, opts = {}) => ({ type: "string", key, size, ...opts });
const int = (key, opts = {}) => ({ type: "integer", key, ...opts });
const dbl = (key, opts = {}) => ({ type: "double", key, ...opts });
const bool = (key, opts = {}) => ({ type: "boolean", key, ...opts });
const dt = (key, opts = {}) => ({ type: "datetime", key, ...opts });
const enm = (key, elements, opts = {}) => ({ type: "enum", key, elements, ...opts });

/** Attributes every synced collection carries on top of its business columns. */
const SYNC_ATTRS = [
  // Tenant/device namespace — see deviation (2).
  str("sync_scope", 64, { required: true }),
  // The record's natural key, kept verbatim so a document is traceable back to
  // the local row even when the business column is renamed.
  str("local_key", 128, { required: true }),
  // Soft delete: a hard delete is invisible to a puller that only watches
  // $updatedAt, so deletions are propagated as a flag instead.
  bool("deleted", { xdefault: false }),
];

const syncIndexes = (uniqueOn) => [
  { key: "idx_scope", type: "key", attributes: ["sync_scope"] },
  { key: "uniq_natural", type: "unique", attributes: ["sync_scope", ...uniqueOn] },
];

const num = (v, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const text = (v, fallback = "") => (typeof v === "string" ? v : v == null ? fallback : String(v));
const flag = (v, fallback = false) => (typeof v === "boolean" ? v : fallback);
const json = (v) => JSON.stringify(v ?? null);
const unjson = (v, fallback) => {
  if (typeof v !== "string" || v === "") return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

// ── Shared row mapping: PO rows and purchase-request rows are the same shape ──
const rowToRemote = (row, lineNo) => ({
  line_no: lineNo,
  model: text(row.model),
  name: text(row.name),
  unit: text(row.unit),
  pack: Math.trunc(num(row.pack, 1)),
  qty: num(row.qty),
  price: num(row.price),
  cbm: num(row.cbm),
  currency: text(row.currency),
  rate: num(row.rate, 1),
  sale_price: num(row.salePrice, 0),
});

const rowFromRemote = (doc) => {
  const row = {
    id: doc.line_no,
    model: text(doc.model),
    name: text(doc.name),
    unit: text(doc.unit),
    pack: num(doc.pack, 1),
    qty: num(doc.qty),
    price: num(doc.price),
    cbm: num(doc.cbm),
  };
  if (doc.currency) row.currency = doc.currency;
  if (num(doc.rate, 0) > 0) row.rate = doc.rate;
  if (num(doc.sale_price, 0) > 0) row.salePrice = doc.sale_price;
  return row;
};

const ROW_ATTRS = [
  int("line_no", { required: true }),
  str("model", 128),
  str("name", 512),
  str("unit", 64),
  int("pack", { xdefault: 1 }),
  dbl("qty", { xdefault: 0 }),
  dbl("price", { xdefault: 0 }),
  dbl("cbm", { xdefault: 0 }),
  str("currency", 8),
  dbl("rate", { xdefault: 1 }),
  dbl("sale_price", { xdefault: 0 }),
];

// Header fields shared by purchase_orders and purchase_requests.
const HEADER_ATTRS = [
  str("number", 64, { required: true }),
  str("po_date", 32),
  str("invoice_no", 64),
  str("supplier_code", 64),
  str("currency", 8, { xdefault: "USD" }),
  dbl("rate", { xdefault: 1 }),
  str("container_no", 64),
  str("container_size", 32),
  str("distribution_type", 32, { xdefault: "cbm" }),
  dbl("expense_percentage", { xdefault: 0 }),
  str("notes", 4000),
  bool("approved", { xdefault: false }),
];

const headerToRemote = (po) => ({
  number: text(po.number),
  po_date: text(po.date),
  invoice_no: text(po.invoiceNo),
  supplier_code: text(po.supplierCode),
  currency: text(po.currency, "USD"),
  rate: num(po.rate, 1),
  container_no: text(po.containerNo),
  container_size: text(po.containerSize),
  distribution_type: text(po.distributionType, "cbm"),
  expense_percentage: num(po.expensePercentage),
  notes: text(po.notes),
  approved: flag(po.approved),
});

const headerFromRemote = (doc) => ({
  number: text(doc.number),
  date: text(doc.po_date),
  invoiceNo: text(doc.invoice_no),
  supplierCode: text(doc.supplier_code),
  currency: text(doc.currency, "USD"),
  rate: num(doc.rate, 1),
  containerNo: text(doc.container_no),
  containerSize: text(doc.container_size),
  distributionType: text(doc.distribution_type, "cbm"),
  expensePercentage: num(doc.expense_percentage),
  notes: text(doc.notes),
  approved: flag(doc.approved),
});

/**
 * Every collection created in Appwrite.
 *
 * `sync` is present only on collections that participate in push/pull:
 *   localTable — the `erp_tables.name` key holding the JSON array
 *   key        — field on the local record that is its natural key
 *   toRemote   — local record -> Appwrite attributes
 *   fromRemote — Appwrite document -> local record
 *   children   — nested local arrays exploded into their own collections
 */
export const COLLECTIONS = [
  // ── Business tables ────────────────────────────────────────────────────────
  {
    id: "suppliers",
    name: "Suppliers",
    attributes: [
      str("code", 64, { required: true }),
      str("name", 255, { required: true }),
      str("country", 100),
      str("city", 100),
      str("phone", 50),
      str("email", 320),
      str("currency", 8, { xdefault: "USD" }),
      bool("active", { xdefault: true }),
      str("notes", 4000),
      ...SYNC_ATTRS,
    ],
    indexes: syncIndexes(["code"]),
    sync: {
      localTable: "suppliers",
      key: "code",
      toRemote: (s) => ({
        code: text(s.code),
        name: text(s.name),
        country: text(s.country),
        city: text(s.city),
        phone: text(s.phone),
        email: text(s.email),
        currency: text(s.currency, "USD"),
        active: flag(s.active, true),
        notes: text(s.notes),
      }),
      fromRemote: (d) => ({
        code: text(d.code),
        name: text(d.name),
        country: text(d.country),
        city: text(d.city),
        phone: text(d.phone),
        email: text(d.email),
        currency: text(d.currency, "USD"),
        notes: text(d.notes),
        active: flag(d.active, true),
      }),
    },
  },

  {
    id: "items",
    name: "Items",
    attributes: [
      str("code", 64, { required: true }),
      str("barcode", 64),
      str("name", 512, { required: true }),
      str("category", 128),
      // [{name, pack, lastPrice}] — JSONB in Supabase, JSON text here.
      str("units", 100000),
      dbl("cbm_per_carton", { xdefault: 0 }),
      dbl("last_cost", { xdefault: 0 }),
      str("currency", 8),
      dbl("rate", { xdefault: 0 }),
      bool("active", { xdefault: true }),
      ...SYNC_ATTRS,
    ],
    indexes: syncIndexes(["code"]),
    sync: {
      localTable: "items",
      key: "code",
      toRemote: (i) => ({
        code: text(i.code),
        barcode: text(i.barcode),
        name: text(i.name),
        category: text(i.category),
        units: json(i.units ?? []),
        cbm_per_carton: num(i.cbmPerCarton),
        last_cost: num(i.lastCost),
        currency: text(i.currency),
        rate: num(i.rate),
        active: flag(i.active, true),
      }),
      fromRemote: (d) => {
        const item = {
          code: text(d.code),
          name: text(d.name),
          barcode: text(d.barcode),
          units: unjson(d.units, []),
          cbmPerCarton: num(d.cbm_per_carton),
          lastCost: num(d.last_cost),
        };
        if (d.currency) item.currency = d.currency;
        if (num(d.rate, 0) > 0) item.rate = d.rate;
        return item;
      },
    },
  },

  {
    id: "purchase_orders",
    name: "Purchase Orders",
    attributes: [...HEADER_ATTRS, ...SYNC_ATTRS],
    indexes: syncIndexes(["number"]),
    sync: {
      localTable: "purchase_orders",
      key: "number",
      toRemote: headerToRemote,
      fromRemote: headerFromRemote,
      children: [
        { collection: "po_rows", field: "rows", toRemote: rowToRemote, fromRemote: rowFromRemote },
        {
          collection: "po_expenses",
          field: "expenses",
          toRemote: (e, lineNo) => ({
            line_no: lineNo,
            expense_type: text(e.type),
            note: text(e.note),
            currency: text(e.currency, "USD"),
            amount: num(e.amount),
            rate: num(e.rate, 1),
            account_no: text(e.accountNo),
            analytic_account: text(e.analyticAccount),
            center_no: text(e.centerNo),
            attached: flag(e.attached),
            invoice_no: text(e.invoiceNo),
            invoice_date: text(e.invoiceDate),
            branch: text(e.branch),
          }),
          fromRemote: (d) => {
            const exp = {
              id: d.line_no,
              type: text(d.expense_type),
              note: text(d.note),
              currency: text(d.currency, "USD"),
              amount: num(d.amount),
              rate: num(d.rate, 1),
            };
            if (d.account_no) exp.accountNo = d.account_no;
            if (d.analytic_account) exp.analyticAccount = d.analytic_account;
            if (d.center_no) exp.centerNo = d.center_no;
            if (d.attached) exp.attached = true;
            if (d.invoice_no) exp.invoiceNo = d.invoice_no;
            if (d.invoice_date) exp.invoiceDate = d.invoice_date;
            if (d.branch) exp.branch = d.branch;
            return exp;
          },
        },
      ],
    },
  },

  {
    id: "po_rows",
    name: "PO Rows",
    // Child collection — written and read only through purchase_orders.
    attributes: [str("po_number", 64, { required: true }), ...ROW_ATTRS, ...SYNC_ATTRS],
    indexes: [
      { key: "idx_scope", type: "key", attributes: ["sync_scope"] },
      { key: "idx_parent", type: "key", attributes: ["sync_scope", "po_number"] },
      { key: "uniq_natural", type: "unique", attributes: ["sync_scope", "po_number", "line_no"] },
    ],
  },

  {
    id: "po_expenses",
    name: "PO Expenses",
    attributes: [
      str("po_number", 64, { required: true }),
      int("line_no", { required: true }),
      str("expense_type", 128),
      str("note", 1000),
      str("currency", 8, { xdefault: "USD" }),
      dbl("amount", { xdefault: 0 }),
      dbl("rate", { xdefault: 1 }),
      str("account_no", 64),
      str("analytic_account", 64),
      str("center_no", 64),
      bool("attached", { xdefault: false }),
      str("invoice_no", 64),
      str("invoice_date", 32),
      str("branch", 128),
      ...SYNC_ATTRS,
    ],
    indexes: [
      { key: "idx_scope", type: "key", attributes: ["sync_scope"] },
      { key: "idx_parent", type: "key", attributes: ["sync_scope", "po_number"] },
      { key: "uniq_natural", type: "unique", attributes: ["sync_scope", "po_number", "line_no"] },
    ],
  },

  // Purchase requests have no Supabase counterpart — they exist only in the
  // shipped app (src/lib/erp-types.ts) and must survive a sync round-trip.
  {
    id: "purchase_requests",
    name: "Purchase Requests",
    attributes: [...HEADER_ATTRS, dbl("cbm_price", { xdefault: 0 }), ...SYNC_ATTRS],
    indexes: syncIndexes(["number"]),
    sync: {
      localTable: "purchase_requests",
      key: "number",
      toRemote: (pr) => ({ ...headerToRemote(pr), cbm_price: num(pr.cbmPrice) }),
      fromRemote: (d) => ({ ...headerFromRemote(d), cbmPrice: num(d.cbm_price) }),
      children: [
        {
          collection: "purchase_request_rows",
          field: "rows",
          parentKey: "pr_number",
          toRemote: rowToRemote,
          fromRemote: rowFromRemote,
        },
      ],
    },
  },

  {
    id: "purchase_request_rows",
    name: "Purchase Request Rows",
    attributes: [str("pr_number", 64, { required: true }), ...ROW_ATTRS, ...SYNC_ATTRS],
    indexes: [
      { key: "idx_scope", type: "key", attributes: ["sync_scope"] },
      { key: "idx_parent", type: "key", attributes: ["sync_scope", "pr_number"] },
      { key: "uniq_natural", type: "unique", attributes: ["sync_scope", "pr_number", "line_no"] },
    ],
  },

  {
    id: "audit_log",
    name: "Audit Log",
    attributes: [
      str("user_id", 64),
      str("user_email", 320),
      str("action", 32, { required: true }),
      str("table_name", 64, { required: true }),
      str("record_id", 128),
      str("before_data", 500000),
      str("after_data", 500000),
      dt("created_at"),
      ...SYNC_ATTRS,
    ],
    indexes: [
      { key: "idx_scope", type: "key", attributes: ["sync_scope"] },
      { key: "idx_table", type: "key", attributes: ["table_name"] },
      { key: "uniq_natural", type: "unique", attributes: ["sync_scope", "local_key"] },
    ],
    sync: {
      localTable: "audit_log",
      key: "id",
      toRemote: (a) => ({
        user_email: text(a.user_email),
        action: text(a.action),
        table_name: text(a.table_name),
        record_id: text(a.record_id),
        before_data: json(a.before_data),
        after_data: json(a.after_data),
        created_at: toIso(a.created_at),
      }),
      fromRemote: (d) => ({
        id: Number(d.local_key),
        user_email: d.user_email || null,
        action: text(d.action),
        table_name: text(d.table_name),
        record_id: d.record_id || null,
        before_data: unjson(d.before_data, null),
        after_data: unjson(d.after_data, null),
        created_at: text(d.created_at),
      }),
    },
  },

  // ── Identity mirror (schema parity only — never synced from SQLite) ─────────
  // The local `users` table stores bcrypt hashes and salts; pushing those into
  // a cloud collection would move credential material off the device, so sync
  // deliberately skips it. These two mirror the Supabase tables so the schema
  // is complete and an admin UI can write to them directly.
  {
    id: "profiles",
    name: "Profiles",
    attributes: [
      str("user_id", 64, { required: true }),
      str("email", 320, { required: true }),
      str("full_name", 255),
      dt("created_at"),
    ],
    indexes: [{ key: "uniq_user", type: "unique", attributes: ["user_id"] }],
  },

  {
    id: "user_roles",
    name: "User Roles",
    attributes: [
      str("user_id", 64, { required: true }),
      enm("role", ["admin", "user", "viewer"], { required: true }),
      dt("created_at"),
    ],
    indexes: [{ key: "uniq_user_role", type: "unique", attributes: ["user_id", "role"] }],
  },

  // ── Licensing / distribution (mirrors 20260723082319_*.sql) ────────────────
  {
    id: "licenses",
    name: "Licenses",
    attributes: [
      str("code", 128, { required: true }),
      enm("license_type", ["permanent", "monthly"], { required: true }),
      dt("expires_at"), // null for permanent
      int("max_devices", { xdefault: 1 }),
      bool("active", { xdefault: true }),
      str("customer_name", 255),
      str("notes", 4000),
      str("created_by", 64),
    ],
    indexes: [
      { key: "uniq_code", type: "unique", attributes: ["code"] },
      { key: "idx_active", type: "key", attributes: ["active"] },
    ],
  },

  {
    id: "activations",
    name: "Activations",
    attributes: [
      str("license_id", 64, { required: true }),
      str("machine_fingerprint", 128, { required: true }),
      str("device_name", 255),
      str("session_token_hash", 128, { required: true }), // sha256 of the token only
      dt("activated_at"),
      dt("last_seen_at"),
      bool("revoked", { xdefault: false }),
      dt("revoked_at"),
    ],
    indexes: [
      { key: "idx_license", type: "key", attributes: ["license_id"] },
      { key: "uniq_device", type: "unique", attributes: ["license_id", "machine_fingerprint"] },
    ],
  },

  {
    id: "app_bundles",
    name: "App Bundles",
    attributes: [
      str("version", 32, { required: true }),
      str("encrypted_blob", 1000000, { required: true }), // base64 AES-256-GCM (iv|tag|ct)
      str("signature", 2000, { required: true }), // base64 RSA-4096 over the blob
      str("min_shell_version", 32, { xdefault: "1.0.0" }),
      bool("is_current", { xdefault: false }),
      int("size_bytes"),
      str("notes", 4000),
    ],
    indexes: [
      { key: "uniq_version", type: "unique", attributes: ["version"] },
      { key: "idx_current", type: "key", attributes: ["is_current"] },
    ],
  },

  {
    id: "heartbeats",
    name: "Heartbeats",
    attributes: [
      str("activation_id", 64, { required: true }),
      str("ip_hash", 128),
      str("user_agent", 512),
    ],
    indexes: [{ key: "idx_activation", type: "key", attributes: ["activation_id"] }],
  },

  {
    id: "erp_backups",
    name: "ERP Backups",
    attributes: [
      str("activation_id", 64, { required: true }),
      str("payload", 1000000, { required: true }),
    ],
    indexes: [{ key: "idx_activation", type: "key", attributes: ["activation_id"] }],
  },
];

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Collections that push/pull actually walk, in dependency order. */
export const SYNCED = COLLECTIONS.filter((c) => c.sync);

export const byId = (id) => COLLECTIONS.find((c) => c.id === id);

/** Child collections are written through their parent, never on their own. */
export const CHILD_IDS = new Set(
  SYNCED.flatMap((c) => (c.sync.children ?? []).map((ch) => ch.collection)),
);
