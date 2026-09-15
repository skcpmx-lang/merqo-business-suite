/**
 * IPC contract — single source of truth shared by the main process (handler
 * registry), the preload bridge (implementation) and the renderer (typed
 * `window.merqo` client).
 *
 * Conventions:
 *  - Every business-scoped request carries the session `token` as first arg.
 *  - Write operations accept an optional `idempotencyKey` (double-submission
 *    protection, replayed in the main process).
 *  - Errors cross the bridge as { code, message } — never raw stack traces.
 *  - Money is always integer paise; ids are ULIDs; dates are epoch ms.
 */

export type Row = Record<string, unknown>;

export const IPC = {
  // app
  APP_INFO: 'app:info',
  APP_INTEGRITY: 'app:integrity',
  APP_SAVE_FILE: 'app:saveFile',
  APP_PICK_DIRECTORY: 'app:pickDirectory',
  // auth
  AUTH_STATUS: 'auth:status',
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_ME: 'auth:me',
  // setup / business / settings
  SETUP_CREATE: 'setup:create',
  BUSINESS_GET: 'business:get',
  BUSINESS_UPDATE: 'business:update',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_SECTION: 'settings:section',
  SETTINGS_LIST: 'settings:list',
  // dashboard + notifications
  DASHBOARD_GET: 'dashboard:get',
  NOTIFICATIONS_LIST: 'notifications:list',
  NOTIFICATIONS_UNREAD: 'notifications:unread',
  NOTIFICATIONS_READ: 'notifications:read',
  NOTIFICATIONS_READ_ALL: 'notifications:readAll',
  NOTIFICATIONS_DELETE: 'notifications:delete',
  NOTIFICATIONS_SCAN: 'notifications:scan',
  // products
  PRODUCTS_QUERY: 'products:query',
  PRODUCTS_GET: 'products:get',
  PRODUCTS_BARCODE: 'products:barcode',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_PRICE_HISTORY: 'products:priceHistory',
  // master data
  MASTER_CATEGORIES_LIST: 'master:categories:list',
  MASTER_CATEGORIES_CREATE: 'master:categories:create',
  MASTER_CATEGORIES_UPDATE: 'master:categories:update',
  MASTER_CATEGORIES_DELETE: 'master:categories:delete',
  MASTER_BRANDS_LIST: 'master:brands:list',
  MASTER_BRANDS_CREATE: 'master:brands:create',
  MASTER_UNITS_LIST: 'master:units:list',
  MASTER_UNITS_CREATE: 'master:units:create',
  // stock
  STOCK_ADJUST: 'stock:adjust',
  STOCK_MOVEMENTS: 'stock:movements',
  STOCK_SUMMARY: 'stock:summary',
  STOCK_RECONCILE: 'stock:reconcile',
  STOCK_BATCHES: 'stock:batches',
  // sales
  SALES_CREATE: 'sales:create',
  SALES_GET: 'sales:get',
  SALES_QUERY: 'sales:query',
  SALES_VOID: 'sales:void',
  SALES_HOLD: 'sales:hold',
  SALES_HELD_LIST: 'sales:held:list',
  SALES_HELD_RESUME: 'sales:held:resume',
  SALES_HELD_CANCEL: 'sales:held:cancel',
  SALES_RETURN_CREATE: 'sales:return:create',
  // purchases
  PURCHASES_CREATE: 'purchases:create',
  PURCHASES_GET: 'purchases:get',
  PURCHASES_QUERY: 'purchases:query',
  PURCHASES_RETURN_CREATE: 'purchases:return:create',
  // suppliers / customers
  SUPPLIERS_LIST: 'suppliers:list',
  SUPPLIERS_GET: 'suppliers:get',
  SUPPLIERS_CREATE: 'suppliers:create',
  SUPPLIERS_UPDATE: 'suppliers:update',
  SUPPLIERS_PAY: 'suppliers:pay',
  SUPPLIERS_LEDGER: 'suppliers:ledger',
  CUSTOMERS_LIST: 'customers:list',
  CUSTOMERS_GET: 'customers:get',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_COLLECT: 'customers:collect',
  CUSTOMERS_LEDGER: 'customers:ledger',
  // expenses
  EXPENSES_CREATE: 'expenses:create',
  EXPENSES_GET: 'expenses:get',
  EXPENSES_LIST: 'expenses:list',
  EXPENSES_CATEGORIES_LIST: 'expenses:categories:list',
  EXPENSES_CATEGORIES_CREATE: 'expenses:categories:create',
  // accounts
  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_TRANSACTIONS: 'accounts:transactions',
  ACCOUNTS_TRANSFER: 'accounts:transfer',
  // shift
  SHIFT_OPEN: 'shift:open',
  SHIFT_GET_OPEN: 'shift:getOpen',
  SHIFT_CASH_SUMMARY: 'shift:cashSummary',
  SHIFT_CLOSE: 'shift:close',
  SHIFT_LIST: 'shift:list',
  SHIFT_DAILY_CLOSING: 'shift:dailyClosing',
  // MFS agent
  MFS_PROVIDERS: 'mfs:providers',
  MFS_WALLET_SETUP: 'mfs:wallet:setup',
  MFS_COMMISSION_LIST: 'mfs:commission:list',
  MFS_COMMISSION_SAVE: 'mfs:commission:save',
  MFS_CREATE: 'mfs:create',
  MFS_QUERY: 'mfs:query',
  MFS_RECONCILIATION: 'mfs:reconciliation',
  MFS_SUMMARY: 'mfs:summary',
  // reports (mirror of the Reports engine — dashboard & reports never diverge)
  REPORT_SALES_SUMMARY: 'reports:salesSummary',
  REPORT_SALES_BY_DAY: 'reports:salesByDay',
  REPORT_SALES_BY_PAYMENT: 'reports:salesByPaymentMethod',
  REPORT_SALES_BY_PRODUCT: 'reports:salesByProduct',
  REPORT_SALES_BY_CATEGORY: 'reports:salesByCategory',
  REPORT_SALES_BY_CUSTOMER: 'reports:salesByCustomer',
  REPORT_SALES_BY_CASHIER: 'reports:salesByCashier',
  REPORT_PURCHASE_SUMMARY: 'reports:purchaseSummary',
  REPORT_PURCHASES_BY_SUPPLIER: 'reports:purchasesBySupplier',
  REPORT_PURCHASES_BY_PRODUCT: 'reports:purchasesByProduct',
  REPORT_STOCK_SUMMARY: 'reports:stockSummary',
  REPORT_TOP_STOCK_VALUE: 'reports:topStockValue',
  REPORT_DEAD_STOCK: 'reports:deadStock',
  REPORT_FAST_MOVING: 'reports:fastMoving',
  REPORT_SLOW_MOVING: 'reports:slowMoving',
  REPORT_EXPIRING_BATCHES: 'reports:expiringBatches',
  REPORT_DAMAGED_STOCK: 'reports:damagedStock',
  REPORT_PROFIT_AND_LOSS: 'reports:profitAndLoss',
  REPORT_EXPENSES_BY_CATEGORY: 'reports:expensesByCategory',
  REPORT_CASH_FLOW_BY_DAY: 'reports:cashFlowByDay',
  REPORT_ACCOUNT_BALANCE_SHEET: 'reports:accountBalanceSheet',
  REPORT_RECEIVABLE_PAYABLE: 'reports:receivablePayable',
  REPORT_TOP_CUSTOMER_DUES: 'reports:topCustomerDues',
  REPORT_TOP_SUPPLIER_PAYABLES: 'reports:topSupplierPayables',
  REPORT_COLLECTIONS_BY_DAY: 'reports:collectionsByDay',
  // import / export
  IMPORT_PREVIEW: 'import:preview',
  IMPORT_EXECUTE: 'import:execute',
  IMPORT_JOBS: 'import:jobs',
  IMPORT_ERRORS: 'import:errors',
  EXPORT_CSV: 'export:csv',
  // users / roles / audit
  USERS_LIST: 'users:list',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_CHANGE_PASSWORD: 'users:changePassword',
  ROLES_LIST: 'roles:list',
  ROLES_PERMISSIONS: 'roles:permissions',
  ROLES_SET_PERMISSIONS: 'roles:setPermissions',
  AUDIT_QUERY: 'audit:query',
  // search
  SEARCH_GLOBAL: 'search:global',
  // backup
  BACKUP_CREATE: 'backup:create',
  BACKUP_LIST: 'backup:list',
  BACKUP_VERIFY: 'backup:verify',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_DELETE: 'backup:delete',
  BACKUP_DIR_GET: 'backup:directory:get',
  BACKUP_DIR_SET: 'backup:directory:set',
  // print
  PRINT_RECEIPT_HTML: 'print:receiptHtml',
  PRINT_INVOICE_HTML: 'print:invoiceHtml',
  PRINT_PDF: 'print:pdf'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** Serialized error crossing the IPC boundary (no stack, Bangla message). */
export interface IpcError {
  code: 'VALIDATION' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'CONFLICT' | 'BUSINESS' | 'INTERNAL';
  message: string;
}

/* ---------------- request / response types ---------------- */

export interface Range {
  from: number;
  to: number;
}

export interface LoginRequest {
  businessId: string;
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  sessionId: string;
  businessId: string;
  name: string;
  username: string;
  roleName: string;
  isOwner: boolean;
  permissions: string[];
}

export interface AuthStatus {
  hasBusiness: boolean;
  business: { id: string; name: string } | null;
}

export interface AppInfo {
  version: string;
  platform: string;
  schemaVersion: number;
  dataDirectory: string;
}

export interface CreateSaleRequest {
  lines: {
    productId: string;
    quantity: number;
    unitPricePaise?: number;
    discountPaise?: number;
    batchId?: string | null;
  }[];
  payments: { method: string; amountPaise: number }[];
  customerId?: string | null;
  discountPaise?: number;
  note?: string;
  at?: number;
  idempotencyKey?: string;
}

export interface SaleCreatedResult {
  id: string;
  referenceNo: string;
  totalPaise: number;
  paidPaise: number;
  changePaise: number;
  duePaise: number;
  cogsPaise: number;
  grossProfitPaise: number;
}

export interface CreatePurchaseRequest {
  supplierId: string;
  supplierInvoiceNo?: string;
  lines: { productId: string; quantity: number; unitCostPaise: number; batchId?: string | null }[];
  payments: { method: string; amountPaise: number }[];
  at?: number;
  idempotencyKey?: string;
}

export interface PurchaseCreatedResult {
  id: string;
  referenceNo: string;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
}

export interface CloseShiftResult {
  shiftId: string;
  referenceNo: string;
  openingCashPaise: number;
  expectedCashPaise: number;
  actualCashPaise: number;
  variancePaise: number;
}

export interface MfsCreatedResult {
  id: string;
  referenceNo: string;
  commissionPaise: number;
}

export interface ImportPreviewRequest {
  entity: 'products' | 'customers' | 'suppliers';
  csv: string;
  fieldMap?: Record<string, string>;
}

export interface ImportPreviewResult {
  totalRows: number;
  validRows: number;
  errorCount: number;
  errors: { row: number; field: string; value: string; message: string }[];
  preview: Row[];
}

export interface ImportResult {
  jobId: string;
  imported: number;
  skipped: number;
  errorCount: number;
}

export interface ShiftOpenRequest {
  openingCashPaise: number;
  note?: string;
  idempotencyKey?: string;
}

/** The complete typed surface exposed as `window.merqo`. */
export interface MerqoApi {
  app: {
    info(): Promise<AppInfo>;
    integrity(): Promise<{ ok: boolean; issues: string[] }>;
    saveFile(defaultName: string, content: string): Promise<string | null>;
    pickDirectory(title?: string): Promise<string | null>;
  };
  auth: {
    status(): Promise<AuthStatus>;
    login(req: LoginRequest): Promise<LoginResult>;
    logout(token: string): Promise<void>;
    me(token: string): Promise<LoginResult | null>;
  };
  setup: {
    create(req: Record<string, unknown>): Promise<{ businessId: string; adminUserId: string }>;
  };
  business: {
    get(token: string): Promise<Row>;
    update(token: string, patch: Record<string, unknown>): Promise<void>;
  };
  settings: {
    get(token: string, section: string, key: string, fallback?: unknown): Promise<unknown>;
    set(token: string, section: string, key: string, value: unknown): Promise<void>;
    section(token: string, section: string): Promise<Record<string, unknown>>;
    list(token: string): Promise<Row[]>;
  };
  dashboard: {
    get(token: string, preset: string): Promise<Row>;
  };
  notifications: {
    list(token: string, limit?: number): Promise<Row[]>;
    unread(token: string): Promise<number>;
    read(token: string, id: string): Promise<void>;
    readAll(token: string): Promise<void>;
    remove(token: string, id: string): Promise<void>;
    scan(token: string): Promise<number>;
  };
  products: {
    query(token: string, q: Record<string, unknown>): Promise<{ rows: Row[]; total: number }>;
    get(token: string, id: string): Promise<Row | null>;
    barcode(token: string, barcode: string): Promise<Row | null>;
    create(token: string, input: Record<string, unknown>, idemKey?: string): Promise<string>;
    update(token: string, input: Record<string, unknown>, idemKey?: string): Promise<void>;
    delete(token: string, productId: string, idemKey?: string): Promise<void>;
    priceHistory(token: string, productId: string): Promise<Row[]>;
  };
  master: {
    categories: {
      list(token: string): Promise<Row[]>;
      create(token: string, name: string, parentId?: string | null): Promise<string>;
      update(token: string, id: string, patch: Record<string, unknown>): Promise<void>;
      remove(token: string, id: string): Promise<void>;
    };
    brands: {
      list(token: string): Promise<Row[]>;
      create(token: string, name: string): Promise<string>;
    };
    units: {
      list(token: string): Promise<Row[]>;
      create(token: string, name: string, code: string): Promise<string>;
    };
  };
  stock: {
    adjust(token: string, input: Record<string, unknown>, idemKey?: string): Promise<string>;
    movements(token: string, q: Record<string, unknown>): Promise<Row[]>;
    summary(token: string): Promise<Row>;
    reconcile(token: string): Promise<{ ok: boolean; mismatches: Row[] }>;
    batches(token: string, productId: string): Promise<Row[]>;
  };
  sales: {
    create(token: string, req: CreateSaleRequest): Promise<SaleCreatedResult>;
    get(token: string, idOrRef: string): Promise<Row | null>;
    query(token: string, q: Record<string, unknown>): Promise<{ rows: Row[]; total: number }>;
    void(token: string, saleId: string, reason: string, idemKey?: string): Promise<void>;
    hold(token: string, cart: Record<string, unknown>): Promise<string>;
    heldList(token: string): Promise<Row[]>;
    heldResume(token: string, id: string): Promise<Row | null>;
    heldCancel(token: string, id: string): Promise<void>;
    createReturn(token: string, req: Record<string, unknown>, idemKey?: string): Promise<Row>;
  };
  purchases: {
    create(token: string, req: CreatePurchaseRequest): Promise<PurchaseCreatedResult>;
    get(token: string, idOrRef: string): Promise<Row | null>;
    query(token: string, q: Record<string, unknown>): Promise<{ rows: Row[]; total: number }>;
    createReturn(token: string, req: Record<string, unknown>, idemKey?: string): Promise<Row>;
  };
  suppliers: {
    list(token: string, q?: Record<string, unknown>): Promise<Row[]>;
    get(token: string, id: string): Promise<Row | null>;
    create(token: string, input: Record<string, unknown>): Promise<string>;
    update(token: string, input: Record<string, unknown>): Promise<void>;
    pay(token: string, input: Record<string, unknown>, idemKey?: string): Promise<{ referenceNo: string }>;
    ledger(token: string, id: string): Promise<Row[]>;
  };
  customers: {
    list(token: string, q?: Record<string, unknown>): Promise<Row[]>;
    get(token: string, id: string): Promise<Row | null>;
    create(token: string, input: Record<string, unknown>): Promise<string>;
    update(token: string, input: Record<string, unknown>): Promise<void>;
    collect(token: string, input: Record<string, unknown>, idemKey?: string): Promise<{ referenceNo: string }>;
    ledger(token: string, id: string): Promise<Row[]>;
  };
  expenses: {
    create(token: string, input: Record<string, unknown>, idemKey?: string): Promise<{ referenceNo: string }>;
    get(token: string, id: string): Promise<Row | null>;
    list(token: string, q: Record<string, unknown>): Promise<{ rows: Row[]; total: number }>;
    categories: {
      list(token: string): Promise<Row[]>;
      create(token: string, name: string): Promise<string>;
    };
  };
  accounts: {
    list(token: string): Promise<Row[]>;
    transactions(token: string, q: Record<string, unknown>): Promise<Row[]>;
    transfer(token: string, input: Record<string, unknown>, idemKey?: string): Promise<{ referenceNo: string }>;
  };
  shift: {
    open(token: string, req: ShiftOpenRequest): Promise<{ id: string; referenceNo: string }>;
    getOpen(token: string): Promise<Row | null>;
    cashSummary(token: string, from: number, to: number): Promise<{ cashIn: number; cashOut: number }>;
    close(token: string, req: Record<string, unknown>, idemKey?: string): Promise<CloseShiftResult>;
    list(token: string, q?: Record<string, unknown>): Promise<{ rows: Row[]; total: number }>;
    dailyClosing(token: string): Promise<Row>;
  };
  mfs: {
    providers(token: string): Promise<Row[]>;
    walletSetup(token: string, input: Record<string, unknown>): Promise<void>;
    commission: {
      list(token: string): Promise<Row[]>;
      save(token: string, input: Record<string, unknown>): Promise<void>;
    };
    create(token: string, input: Record<string, unknown>, idemKey?: string): Promise<MfsCreatedResult>;
    query(token: string, q: Record<string, unknown>): Promise<{ rows: Row[]; total: number }>;
    reconciliation(token: string, q: Record<string, unknown>): Promise<Row>;
    summary(token: string, q?: Record<string, unknown>): Promise<Row[]>;
  };
  reports: {
    salesSummary(token: string, r: Range): Promise<Row>;
    salesByDay(token: string, r: Range, step?: 'day' | 'week' | 'month'): Promise<Row[]>;
    salesByPaymentMethod(token: string, r: Range): Promise<Row[]>;
    salesByProduct(token: string, r: Range): Promise<Row[]>;
    salesByCategory(token: string, r: Range): Promise<Row[]>;
    salesByCustomer(token: string, r: Range): Promise<Row[]>;
    salesByCashier(token: string, r: Range): Promise<Row[]>;
    purchaseSummary(token: string, r: Range): Promise<Row>;
    purchasesBySupplier(token: string, r: Range): Promise<Row[]>;
    purchasesByProduct(token: string, r: Range): Promise<Row[]>;
    stockSummary(token: string): Promise<Row>;
    topStockValue(token: string): Promise<Row[]>;
    deadStock(token: string): Promise<Row[]>;
    fastMoving(token: string, r: Range): Promise<Row[]>;
    slowMoving(token: string, r: Range): Promise<Row[]>;
    expiringBatches(token: string): Promise<Row[]>;
    damagedStock(token: string, r: Range): Promise<Row[]>;
    profitAndLoss(token: string, r: Range): Promise<Row>;
    expensesByCategory(token: string, r: Range): Promise<Row[]>;
    cashFlowByDay(token: string, r: Range): Promise<Row[]>;
    accountBalanceSheet(token: string): Promise<Row[]>;
    receivablePayable(token: string): Promise<Row>;
    topCustomerDues(token: string): Promise<Row[]>;
    topSupplierPayables(token: string): Promise<Row[]>;
    collectionsByDay(token: string, r: Range): Promise<Row[]>;
  };
  imports: {
    preview(token: string, req: ImportPreviewRequest): Promise<ImportPreviewResult>;
    execute(token: string, req: ImportPreviewRequest & { note?: string }, idemKey?: string): Promise<ImportResult>;
    jobs(token: string): Promise<Row[]>;
    errors(token: string, jobId: string): Promise<Row[]>;
  };
  exports: {
    csv(token: string, entity: 'products' | 'customers' | 'suppliers' | 'sales' | 'purchases'): Promise<string>;
  };
  users: {
    list(token: string): Promise<Row[]>;
    create(token: string, input: Record<string, unknown>, idemKey?: string): Promise<string>;
    update(token: string, input: Record<string, unknown>, idemKey?: string): Promise<void>;
    changePassword(token: string, req: { userId?: string; currentPassword?: string; newPassword: string }): Promise<void>;
  };
  roles: {
    list(token: string): Promise<Row[]>;
    permissions(token: string, roleId: string): Promise<string[]>;
    setPermissions(token: string, roleId: string, permissions: string[], idemKey?: string): Promise<void>;
  };
  audit: {
    query(token: string, q: Record<string, unknown>): Promise<{ rows: Row[]; total: number }>;
  };
  search: {
    global(token: string, term: string): Promise<Row>;
  };
  backup: {
    create(token: string, idemKey?: string): Promise<Row>;
    list(token: string): Promise<Row[]>;
    verify(token: string, backupId: string): Promise<{ ok: boolean; message: string }>;
    restore(token: string, backupId: string): Promise<{ restartRequired: boolean }>;
    remove(token: string, backupId: string): Promise<void>;
    directory(token: string): Promise<string>;
    setDirectory(token: string, dir: string): Promise<void>;
  };
  print: {
    receiptHtml(token: string, saleId: string, paper?: '57mm' | '80mm' | 'A4'): Promise<string>;
    invoiceHtml(token: string, saleId: string): Promise<string>;
    savePdf(req: { html: string; defaultFileName: string }): Promise<string | null>;
  };
}
