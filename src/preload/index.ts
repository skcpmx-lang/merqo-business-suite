/**
 * MERQO preload — the typed bridge between the renderer and the main
 * process. `window.merqo` implements the exact MerqoApi contract from
 * shared/ipc.ts. Errors surface as MerqoBridgeError { code, message }.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type MerqoApi,
  type IpcError,
  type Range,
  type LoginRequest,
  type CreateSaleRequest,
  type CreatePurchaseRequest,
  type ShiftOpenRequest,
  type ImportPreviewRequest
} from '../shared/ipc';

export class MerqoBridgeError extends Error {
  readonly code: IpcError['code'];
  constructor(err: IpcError) {
    super(err.message);
    this.name = 'MerqoBridgeError';
    this.code = err.code;
  }
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as
    | { ok: true; data: T }
    | { ok: false; error: IpcError };
  if (!res) throw new MerqoBridgeError({ code: 'INTERNAL', message: 'মূল প্রসেস থেকে সাড়া পাওয়া যায়নি।' });
  if (!res.ok) throw new MerqoBridgeError(res.error);
  return res.data;
}

const api: MerqoApi = {
  app: {
    info: () => call(IPC.APP_INFO),
    integrity: () => call(IPC.APP_INTEGRITY),
    saveFile: (defaultName, content) => call(IPC.APP_SAVE_FILE, defaultName, content),
    pickDirectory: (title) => call(IPC.APP_PICK_DIRECTORY, title)
  },
  auth: {
    status: () => call(IPC.AUTH_STATUS),
    login: (req: LoginRequest) => call(IPC.AUTH_LOGIN, req),
    logout: (token) => call(IPC.AUTH_LOGOUT, token),
    me: (token) => call(IPC.AUTH_ME, token)
  },
  setup: {
    create: (req) => call(IPC.SETUP_CREATE, req)
  },
  business: {
    get: (token) => call(IPC.BUSINESS_GET, token),
    update: (token, patch) => call(IPC.BUSINESS_UPDATE, token, patch)
  },
  settings: {
    get: (token, section, key, fallback) => call(IPC.SETTINGS_GET, token, section, key, fallback),
    set: (token, section, key, value) => call(IPC.SETTINGS_SET, token, section, key, value),
    section: (token, section) => call(IPC.SETTINGS_SECTION, token, section),
    list: (token) => call(IPC.SETTINGS_LIST, token)
  },
  dashboard: {
    get: (token, preset) => call(IPC.DASHBOARD_GET, token, preset)
  },
  notifications: {
    list: (token, limit) => call(IPC.NOTIFICATIONS_LIST, token, limit),
    unread: (token) => call(IPC.NOTIFICATIONS_UNREAD, token),
    read: (token, id) => call(IPC.NOTIFICATIONS_READ, token, id),
    readAll: (token) => call(IPC.NOTIFICATIONS_READ_ALL, token),
    remove: (token, id) => call(IPC.NOTIFICATIONS_DELETE, token, id),
    scan: (token) => call(IPC.NOTIFICATIONS_SCAN, token)
  },
  products: {
    query: (token, q) => call(IPC.PRODUCTS_QUERY, token, q),
    get: (token, id) => call(IPC.PRODUCTS_GET, token, id),
    barcode: (token, barcode) => call(IPC.PRODUCTS_BARCODE, token, barcode),
    create: (token, input, idemKey) => call(IPC.PRODUCTS_CREATE, token, input, idemKey),
    update: (token, input, idemKey) => call(IPC.PRODUCTS_UPDATE, token, input, idemKey),
    delete: (token, productId, idemKey) => call(IPC.PRODUCTS_DELETE, token, productId, idemKey),
    priceHistory: (token, productId) => call(IPC.PRODUCTS_PRICE_HISTORY, token, productId)
  },
  master: {
    categories: {
      list: (token) => call(IPC.MASTER_CATEGORIES_LIST, token),
      create: (token, name, parentId) => call(IPC.MASTER_CATEGORIES_CREATE, token, name, parentId ?? null),
      update: (token, id, patch) => call(IPC.MASTER_CATEGORIES_UPDATE, token, id, patch),
      remove: (token, id) => call(IPC.MASTER_CATEGORIES_DELETE, token, id)
    },
    brands: {
      list: (token) => call(IPC.MASTER_BRANDS_LIST, token),
      create: (token, name) => call(IPC.MASTER_BRANDS_CREATE, token, name)
    },
    units: {
      list: (token) => call(IPC.MASTER_UNITS_LIST, token),
      create: (token, name, code) => call(IPC.MASTER_UNITS_CREATE, token, name, code)
    }
  },
  stock: {
    adjust: (token, input, idemKey) => call(IPC.STOCK_ADJUST, token, input, idemKey),
    movements: (token, q) => call(IPC.STOCK_MOVEMENTS, token, q),
    summary: (token) => call(IPC.STOCK_SUMMARY, token),
    reconcile: (token) => call(IPC.STOCK_RECONCILE, token),
    batches: (token, productId) => call(IPC.STOCK_BATCHES, token, productId)
  },
  sales: {
    create: (token, req: CreateSaleRequest) => call(IPC.SALES_CREATE, token, req),
    get: (token, idOrRef) => call(IPC.SALES_GET, token, idOrRef),
    query: (token, q) => call(IPC.SALES_QUERY, token, q),
    void: (token, saleId, reason, idemKey) => call(IPC.SALES_VOID, token, saleId, reason, idemKey),
    hold: (token, cart) => call(IPC.SALES_HOLD, token, cart),
    heldList: (token) => call(IPC.SALES_HELD_LIST, token),
    heldResume: (token, id) => call(IPC.SALES_HELD_RESUME, token, id),
    heldCancel: (token, id) => call(IPC.SALES_HELD_CANCEL, token, id),
    createReturn: (token, req, idemKey) => call(IPC.SALES_RETURN_CREATE, token, req, idemKey)
  },
  purchases: {
    create: (token, req: CreatePurchaseRequest) => call(IPC.PURCHASES_CREATE, token, req),
    get: (token, idOrRef) => call(IPC.PURCHASES_GET, token, idOrRef),
    query: (token, q) => call(IPC.PURCHASES_QUERY, token, q),
    createReturn: (token, req, idemKey) => call(IPC.PURCHASES_RETURN_CREATE, token, req, idemKey)
  },
  suppliers: {
    list: (token, q) => call(IPC.SUPPLIERS_LIST, token, q),
    get: (token, id) => call(IPC.SUPPLIERS_GET, token, id),
    create: (token, input) => call(IPC.SUPPLIERS_CREATE, token, input),
    update: (token, input) => call(IPC.SUPPLIERS_UPDATE, token, input),
    pay: (token, input, idemKey) => call(IPC.SUPPLIERS_PAY, token, input, idemKey),
    ledger: (token, id) => call(IPC.SUPPLIERS_LEDGER, token, id)
  },
  customers: {
    list: (token, q) => call(IPC.CUSTOMERS_LIST, token, q),
    get: (token, id) => call(IPC.CUSTOMERS_GET, token, id),
    create: (token, input) => call(IPC.CUSTOMERS_CREATE, token, input),
    update: (token, input) => call(IPC.CUSTOMERS_UPDATE, token, input),
    collect: (token, input, idemKey) => call(IPC.CUSTOMERS_COLLECT, token, input, idemKey),
    ledger: (token, id) => call(IPC.CUSTOMERS_LEDGER, token, id)
  },
  expenses: {
    create: (token, input, idemKey) => call(IPC.EXPENSES_CREATE, token, input, idemKey),
    get: (token, id) => call(IPC.EXPENSES_GET, token, id),
    list: (token, q) => call(IPC.EXPENSES_LIST, token, q),
    categories: {
      list: (token) => call(IPC.EXPENSES_CATEGORIES_LIST, token),
      create: (token, name) => call(IPC.EXPENSES_CATEGORIES_CREATE, token, name)
    }
  },
  accounts: {
    list: (token) => call(IPC.ACCOUNTS_LIST, token),
    transactions: (token, q) => call(IPC.ACCOUNTS_TRANSACTIONS, token, q),
    transfer: (token, input, idemKey) => call(IPC.ACCOUNTS_TRANSFER, token, input, idemKey)
  },
  shift: {
    open: (token, req: ShiftOpenRequest) => call(IPC.SHIFT_OPEN, token, req),
    getOpen: (token) => call(IPC.SHIFT_GET_OPEN, token),
    cashSummary: (token, from, to) => call(IPC.SHIFT_CASH_SUMMARY, token, from, to),
    close: (token, req, idemKey) => call(IPC.SHIFT_CLOSE, token, req, idemKey),
    list: (token, q) => call(IPC.SHIFT_LIST, token, q),
    dailyClosing: (token) => call(IPC.SHIFT_DAILY_CLOSING, token)
  },
  mfs: {
    providers: (token) => call(IPC.MFS_PROVIDERS, token),
    walletSetup: (token, input) => call(IPC.MFS_WALLET_SETUP, token, input),
    commission: {
      list: (token) => call(IPC.MFS_COMMISSION_LIST, token),
      save: (token, input) => call(IPC.MFS_COMMISSION_SAVE, token, input)
    },
    create: (token, input, idemKey) => call(IPC.MFS_CREATE, token, input, idemKey),
    query: (token, q) => call(IPC.MFS_QUERY, token, q),
    reconciliation: (token, q) => call(IPC.MFS_RECONCILIATION, token, q),
    summary: (token, q) => call(IPC.MFS_SUMMARY, token, q)
  },
  reports: {
    salesSummary: (token, r: Range) => call(IPC.REPORT_SALES_SUMMARY, token, r),
    salesByDay: (token, r, step) => call(IPC.REPORT_SALES_BY_DAY, token, r, step),
    salesByPaymentMethod: (token, r) => call(IPC.REPORT_SALES_BY_PAYMENT, token, r),
    salesByProduct: (token, r) => call(IPC.REPORT_SALES_BY_PRODUCT, token, r),
    salesByCategory: (token, r) => call(IPC.REPORT_SALES_BY_CATEGORY, token, r),
    salesByCustomer: (token, r) => call(IPC.REPORT_SALES_BY_CUSTOMER, token, r),
    salesByCashier: (token, r) => call(IPC.REPORT_SALES_BY_CASHIER, token, r),
    purchaseSummary: (token, r) => call(IPC.REPORT_PURCHASE_SUMMARY, token, r),
    purchasesBySupplier: (token, r) => call(IPC.REPORT_PURCHASES_BY_SUPPLIER, token, r),
    purchasesByProduct: (token, r) => call(IPC.REPORT_PURCHASES_BY_PRODUCT, token, r),
    stockSummary: (token) => call(IPC.REPORT_STOCK_SUMMARY, token),
    topStockValue: (token) => call(IPC.REPORT_TOP_STOCK_VALUE, token),
    deadStock: (token) => call(IPC.REPORT_DEAD_STOCK, token),
    fastMoving: (token, r) => call(IPC.REPORT_FAST_MOVING, token, r),
    slowMoving: (token, r) => call(IPC.REPORT_SLOW_MOVING, token, r),
    expiringBatches: (token) => call(IPC.REPORT_EXPIRING_BATCHES, token),
    damagedStock: (token, r) => call(IPC.REPORT_DAMAGED_STOCK, token, r),
    profitAndLoss: (token, r) => call(IPC.REPORT_PROFIT_AND_LOSS, token, r),
    expensesByCategory: (token, r) => call(IPC.REPORT_EXPENSES_BY_CATEGORY, token, r),
    cashFlowByDay: (token, r) => call(IPC.REPORT_CASH_FLOW_BY_DAY, token, r),
    accountBalanceSheet: (token) => call(IPC.REPORT_ACCOUNT_BALANCE_SHEET, token),
    receivablePayable: (token) => call(IPC.REPORT_RECEIVABLE_PAYABLE, token),
    topCustomerDues: (token) => call(IPC.REPORT_TOP_CUSTOMER_DUES, token),
    topSupplierPayables: (token) => call(IPC.REPORT_TOP_SUPPLIER_PAYABLES, token),
    collectionsByDay: (token, r) => call(IPC.REPORT_COLLECTIONS_BY_DAY, token, r)
  },
  imports: {
    preview: (token, req: ImportPreviewRequest) => call(IPC.IMPORT_PREVIEW, token, req),
    execute: (token, req, idemKey) => call(IPC.IMPORT_EXECUTE, token, req, idemKey),
    jobs: (token) => call(IPC.IMPORT_JOBS, token),
    errors: (token, jobId) => call(IPC.IMPORT_ERRORS, token, jobId)
  },
  exports: {
    csv: (token, entity) => call(IPC.EXPORT_CSV, token, entity)
  },
  users: {
    list: (token) => call(IPC.USERS_LIST, token),
    create: (token, input, idemKey) => call(IPC.USERS_CREATE, token, input, idemKey),
    update: (token, input, idemKey) => call(IPC.USERS_UPDATE, token, input, idemKey),
    changePassword: (token, req) => call(IPC.USERS_CHANGE_PASSWORD, token, req)
  },
  roles: {
    list: (token) => call(IPC.ROLES_LIST, token),
    permissions: (token, roleId) => call(IPC.ROLES_PERMISSIONS, token, roleId),
    setPermissions: (token, roleId, permissions, idemKey) => call(IPC.ROLES_SET_PERMISSIONS, token, roleId, permissions, idemKey)
  },
  audit: {
    query: (token, q) => call(IPC.AUDIT_QUERY, token, q)
  },
  search: {
    global: (token, term) => call(IPC.SEARCH_GLOBAL, token, term)
  },
  backup: {
    create: (token, idemKey) => call(IPC.BACKUP_CREATE, token, idemKey),
    list: (token) => call(IPC.BACKUP_LIST, token),
    verify: (token, backupId) => call(IPC.BACKUP_VERIFY, token, backupId),
    restore: (token, backupId) => call(IPC.BACKUP_RESTORE, token, backupId),
    remove: (token, backupId) => call(IPC.BACKUP_DELETE, token, backupId),
    directory: (token) => call(IPC.BACKUP_DIR_GET, token),
    setDirectory: (token, dir) => call(IPC.BACKUP_DIR_SET, token, dir)
  },
  print: {
    receiptHtml: (token, saleId, paper) => call(IPC.PRINT_RECEIPT_HTML, token, saleId, paper ?? '80mm'),
    invoiceHtml: (token, saleId) => call(IPC.PRINT_INVOICE_HTML, token, saleId),
    savePdf: (req) => call(IPC.PRINT_PDF, req)
  }
};

contextBridge.exposeInMainWorld('merqo', api);
