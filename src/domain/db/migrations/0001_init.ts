/**
 * Migration 0001 — initial schema.
 *
 * Conventions:
 *  - IDs: TEXT ULID primary keys (sortable by creation time).
 *  - Money: INTEGER paise (1 BDT = 100 paise). Never floats (§5, §79).
 *  - Time: INTEGER unix epoch milliseconds (UTC); display is local-tz aware.
 *  - Quantities: REAL, rounded to 4 decimals (units may be fractional, e.g. kg).
 *  - Every business-scoped table carries business_id (multi-business ready, §105).
 *  - Every financial record carries business/user/timestamp/reference fields (§6).
 *  - Denormalized balances (customers/suppliers/accounts) are maintained in the
 *    same transaction as their ledger rows and reconciled by recomputation.
 */
export const m0001_init = `
-- ============ BUSINESS & SETTINGS ============

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  business_type TEXT NOT NULL DEFAULT 'retail',
  logo_data_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  UNIQUE (business_id, section, key)
);
CREATE INDEX idx_settings_business ON settings(business_id);

-- ============ USERS / ROLES / SESSIONS ============

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  pin TEXT,
  role_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_owner INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  UNIQUE (business_id, username)
);
CREATE INDEX idx_users_business ON users(business_id);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, key)
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id, started_at DESC);
CREATE INDEX idx_sessions_business ON sessions(business_id, status);

CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  success INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(business_id, created_at DESC);

-- ============ PRODUCT MASTER ============

CREATE TABLE product_categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES product_categories(id) ON DELETE SET NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_categories_business ON product_categories(business_id, is_active);

CREATE TABLE product_brands (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, name)
);

CREATE TABLE product_units (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, code)
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES product_categories(id) ON DELETE SET NULL,
  brand_id TEXT REFERENCES product_brands(id) ON DELETE SET NULL,
  unit_id TEXT NOT NULL REFERENCES product_units(id) ON DELETE RESTRICT,
  purchase_price_paise INTEGER NOT NULL DEFAULT 0,
  selling_price_paise INTEGER NOT NULL DEFAULT 0,
  wholesale_price_paise INTEGER NOT NULL DEFAULT 0,
  min_selling_price_paise INTEGER NOT NULL DEFAULT 0,
  promotional_price_paise INTEGER,
  batch_enabled INTEGER NOT NULL DEFAULT 0,
  expiry_enabled INTEGER NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  image_data_url TEXT,
  default_supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  updated_by TEXT
);
CREATE INDEX idx_products_business ON products(business_id, status);
CREATE INDEX idx_products_name ON products(business_id, name COLLATE NOCASE);
CREATE UNIQUE INDEX idx_products_sku ON products(business_id, sku) WHERE sku <> '';
CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE product_barcodes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, barcode)
);
CREATE INDEX idx_barcodes_lookup ON product_barcodes(business_id, barcode);

CREATE TABLE product_batches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_no TEXT NOT NULL DEFAULT '',
  expiry_date INTEGER,
  quantity REAL NOT NULL DEFAULT 0,
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_batches_product ON product_batches(product_id, status);
CREATE INDEX idx_batches_expiry ON product_batches(business_id, expiry_date);

CREATE TABLE product_price_history (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value INTEGER,
  new_value INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT,
  changed_at INTEGER NOT NULL
);
CREATE INDEX idx_price_history ON product_price_history(product_id, changed_at DESC);

-- ============ INVENTORY ============

CREATE TABLE inventory (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 0,
  avg_cost_paise INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (business_id, product_id)
);
CREATE INDEX idx_inventory_quantity ON inventory(business_id, quantity);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES product_batches(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_movements_product ON inventory_movements(product_id, created_at DESC);
CREATE INDEX idx_movements_business ON inventory_movements(business_id, created_at DESC);
CREATE INDEX idx_movements_reference ON inventory_movements(reference_type, reference_id);

CREATE TABLE stock_adjustments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  reference_no TEXT NOT NULL,
  adjustment_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_stock_adjustments ON stock_adjustments(business_id, created_at DESC);

-- ============ CUSTOMERS / SUPPLIERS ============

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  customer_type TEXT NOT NULL DEFAULT 'retail',
  credit_limit_paise INTEGER NOT NULL DEFAULT 0,
  opening_due_paise INTEGER NOT NULL DEFAULT 0,
  due_balance_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_customers_business ON customers(business_id, is_active);
CREATE INDEX idx_customers_name ON customers(business_id, name COLLATE NOCASE);
CREATE INDEX idx_customers_phone ON customers(business_id, phone);

CREATE TABLE customer_addresses (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE customer_transactions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  reference_no TEXT,
  payment_method TEXT,
  account_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_cust_tx_customer ON customer_transactions(customer_id, created_at DESC);
CREATE INDEX idx_cust_tx_business ON customer_transactions(business_id, created_at DESC);
CREATE INDEX idx_cust_tx_reference ON customer_transactions(reference_type, reference_id);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  contact_person TEXT NOT NULL DEFAULT '',
  opening_payable_paise INTEGER NOT NULL DEFAULT 0,
  payable_balance_paise INTEGER NOT NULL DEFAULT 0,
  payment_terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_suppliers_business ON suppliers(business_id, is_active);
CREATE INDEX idx_suppliers_name ON suppliers(business_id, name COLLATE NOCASE);

CREATE TABLE supplier_transactions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  reference_no TEXT,
  payment_method TEXT,
  account_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_supp_tx_supplier ON supplier_transactions(supplier_id, created_at DESC);
CREATE INDEX idx_supp_tx_business ON supplier_transactions(business_id, created_at DESC);
CREATE INDEX idx_supp_tx_reference ON supplier_transactions(reference_type, reference_id);

-- ============ PURCHASES ============

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  reference_no TEXT NOT NULL,
  supplier_invoice_no TEXT NOT NULL DEFAULT '',
  date INTEGER NOT NULL,
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  paid_paise INTEGER NOT NULL DEFAULT 0,
  due_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (business_id, reference_no)
);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id, date DESC);
CREATE INDEX idx_purchases_business ON purchases(business_id, date DESC);

CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES product_batches(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL,
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  line_total_paise INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_purchase_items ON purchase_items(purchase_id);
CREATE INDEX idx_purchase_items_product ON purchase_items(product_id);

CREATE TABLE purchase_payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  reference TEXT NOT NULL DEFAULT '',
  cheque_no TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  cheque_date INTEGER,
  user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_purchase_payments ON purchase_payments(purchase_id, created_at);

CREATE TABLE purchase_returns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  reference_no TEXT NOT NULL,
  date INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  total_paise INTEGER NOT NULL DEFAULT 0,
  refund_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  user_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, reference_no)
);
CREATE INDEX idx_purchase_returns ON purchase_returns(purchase_id);

CREATE TABLE purchase_return_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity REAL NOT NULL,
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  line_total_paise INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_pr_items ON purchase_return_items(return_id);

-- ============ SALES ============

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  reference_no TEXT NOT NULL,
  date INTEGER NOT NULL,
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  paid_paise INTEGER NOT NULL DEFAULT 0,
  due_paise INTEGER NOT NULL DEFAULT 0,
  cogs_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (business_id, reference_no)
);
CREATE INDEX idx_sales_business ON sales(business_id, date DESC);
CREATE INDEX idx_sales_customer ON sales(customer_id, date DESC);
CREATE INDEX idx_sales_user ON sales(user_id, date DESC);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES product_batches(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL DEFAULT '',
  sku_snapshot TEXT NOT NULL DEFAULT '',
  barcode_snapshot TEXT NOT NULL DEFAULT '',
  unit_id TEXT,
  quantity REAL NOT NULL,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  line_total_paise INTEGER NOT NULL DEFAULT 0,
  cogs_paise INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sale_items ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

CREATE TABLE sale_payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  reference TEXT NOT NULL DEFAULT '',
  cheque_no TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  cheque_date INTEGER,
  user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sale_payments ON sale_payments(sale_id, created_at);

CREATE TABLE sales_returns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  reference_no TEXT NOT NULL,
  date INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  total_paise INTEGER NOT NULL DEFAULT 0,
  refund_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  user_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, reference_no)
);
CREATE INDEX idx_sales_returns ON sales_returns(sale_id);

CREATE TABLE sales_return_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  return_id TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity REAL NOT NULL,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  line_total_paise INTEGER NOT NULL DEFAULT 0,
  restock INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_sr_items ON sales_return_items(return_id);

CREATE TABLE held_carts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'held',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_held_carts ON held_carts(business_id, user_id, status);

-- ============ EXPENSES ============

CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, name)
);
CREATE INDEX idx_expense_categories ON expense_categories(business_id, is_active);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  reference_no TEXT NOT NULL,
  date INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_expenses_business ON expenses(business_id, date DESC);
CREATE INDEX idx_expenses_category ON expenses(category_id, date DESC);

-- ============ ACCOUNTS ============

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  mfs_provider TEXT,
  opening_balance_paise INTEGER NOT NULL DEFAULT 0,
  balance_paise INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_accounts_business ON accounts(business_id, is_active);

CREATE TABLE account_transactions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  balance_after_paise INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  reference_no TEXT,
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_acct_tx_account ON account_transactions(account_id, created_at DESC);
CREATE INDEX idx_acct_tx_business ON account_transactions(business_id, created_at DESC);
CREATE INDEX idx_acct_tx_reference ON account_transactions(reference_type, reference_id);

CREATE TABLE account_transfers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  reference_no TEXT NOT NULL,
  from_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_transfers ON account_transfers(business_id, created_at DESC);

-- ============ CASH SESSIONS / SHIFTS ============

CREATE TABLE cash_sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  reference_no TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  opening_cash_paise INTEGER NOT NULL DEFAULT 0,
  expected_cash_paise INTEGER,
  actual_cash_paise INTEGER,
  variance_paise INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, reference_no)
);
CREATE INDEX idx_cash_sessions ON cash_sessions(business_id, status);

-- ============ MFS AGENT ============

CREATE TABLE mfs_providers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, key)
);

CREATE TABLE mfs_wallets (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES mfs_providers(id) ON DELETE CASCADE,
  account_no TEXT NOT NULL DEFAULT '',
  opening_balance_paise INTEGER NOT NULL DEFAULT 0,
  balance_paise INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_mfs_wallets ON mfs_wallets(business_id, provider_id);

CREATE TABLE mfs_commission_rules (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES mfs_providers(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  rate_bps INTEGER NOT NULL DEFAULT 0,
  fixed_amount_paise INTEGER NOT NULL DEFAULT 0,
  min_paise INTEGER NOT NULL DEFAULT 0,
  max_paise INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, provider_id, transaction_type)
);

CREATE TABLE mfs_transactions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  reference_no TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES mfs_providers(id) ON DELETE CASCADE,
  wallet_id TEXT REFERENCES mfs_wallets(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  txn_ref TEXT NOT NULL DEFAULT '',
  commission_paise INTEGER NOT NULL DEFAULT 0,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  operator TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',
  user_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (business_id, reference_no)
);
CREATE INDEX idx_mfs_tx_business ON mfs_transactions(business_id, created_at DESC);
CREATE INDEX idx_mfs_tx_provider ON mfs_transactions(provider_id, created_at DESC);

-- ============ DOCUMENTS / PRINT ============

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  reference_no TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT,
  UNIQUE (business_id, reference_no)
);
CREATE INDEX idx_invoices_lookup ON invoices(business_id, reference_no);
CREATE INDEX idx_invoices_entity ON invoices(entity_type, entity_id);

CREATE TABLE invoice_templates (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  paper TEXT NOT NULL DEFAULT '80mm',
  settings_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE print_jobs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  reference_no TEXT NOT NULL,
  format TEXT NOT NULL,
  printer TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_print_jobs ON print_jobs(business_id, created_at DESC);

-- ============ NOTIFICATIONS / AUDIT ============

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  entity_type TEXT,
  entity_id TEXT,
  action_route TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications ON notifications(business_id, is_read, created_at DESC);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_business ON audit_logs(business_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(business_id, action, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ============ BACKUPS / IMPORTS ============

CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_backups ON backups(business_id, created_at DESC);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  report_json TEXT,
  user_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE import_errors (
  id TEXT PRIMARY KEY,
  import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  field TEXT,
  value TEXT,
  message TEXT NOT NULL
);
CREATE INDEX idx_import_errors ON import_errors(import_job_id);

-- ============ SEQUENCES / EVENTS ============

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE app_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_app_events ON app_events(business_id, created_at DESC);
`;
