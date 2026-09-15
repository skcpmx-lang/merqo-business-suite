/**
 * IPC handler registry — the ONLY place renderer calls reach the domain.
 *
 *  - session token → SessionUser resolution on every business channel
 *  - permission enforcement (requirePermission) at the boundary
 *  - idempotency-key replay for write operations (double-submission safe)
 *  - errors serialized to { code, message } — no stack traces cross the bridge
 *
 * Handler signature: run(user, args) where args[0] is always the DB.
 */
import { createHash } from 'node:crypto';
import { ipcMain } from 'electron';
import type { DB } from '../../domain/db/connection';
import { IPC, type IpcError, type Range } from '../../shared/ipc';
import { ValidationError, UnauthorizedError, NotFoundError, ConflictError } from '../../domain/errors';
import {
  login, logout, resolveSession, listUsers, createUser, updateUser, changePassword,
  listRoles, getRolePermissions, setRolePermissions, requirePermission,
  type SessionUser
} from '../../domain/services/userService';
import { createBusiness, getBusiness, getActiveBusiness, updateBusiness, verifyPassword } from '../../domain/services/setupService';
import { getSetting, setSetting, getSectionSettings, listAllSettings } from '../../domain/repos/settings';
import { getDashboard } from '../../domain/services/dashboardService';
import {
  queryNotifications, unreadCount, markRead, markAllRead, deleteNotification, scanAndNotify
} from '../../domain/services/notificationService';
import { createProduct, updateProductSafe, softDeleteProduct, getProductDetail } from '../../domain/services/productService';
import {
  queryProducts, findProductByBarcode, listCategories, insertCategory, updateCategory, deleteCategory,
  listBrands, insertBrand, listUnits, insertUnit, listPriceHistory, listActiveBatches
} from '../../domain/repos/master';
import { adjustStock, movementHistory, inventorySummary, reconcileInventory } from '../../domain/services/inventoryService';
import {
  createSale, getSale, querySales, voidSale, holdSale, listHeldCarts,
  resumeHeldSale, cancelHeldSale
} from '../../domain/services/saleService';
import { createPurchase, getPurchase, queryPurchases } from '../../domain/services/purchaseService';
import { createSalesReturn, createPurchaseReturn } from '../../domain/services/returnService';
import {
  listSuppliers, getSupplier, createSupplier, updateSupplier, paySupplier, supplierLedger
} from '../../domain/services/supplierService';
import {
  listCustomers, getCustomer, createCustomer, updateCustomer,
  collectCustomerPayment, customerLedger
} from '../../domain/services/customerService';
import {
  listExpenseCategories, createExpenseCategory, createExpense, listExpenses, getExpense
} from '../../domain/services/expenseService';
import { listAccounts, accountTransactions, transfer } from '../../domain/services/accountService';
import {
  openShift, getOpenShiftOne, shiftCashSummary, closeShift, listShifts, dailyClosingReport
} from '../../domain/services/cashSessionService';
import {
  listProviders, setupWallet, listCommissionRules, saveCommissionRule,
  createMfsTransaction, queryMfsTransactions, mfsReconciliation, mfsSummary
} from '../../domain/services/mfsService';
import { createReports } from '../../domain/services/reportService';
import { previewImport, executeImport, listImportJobs, getImportErrors } from '../../domain/services/importService';
import { globalSearch } from '../../domain/services/searchService';
import { queryAudit } from '../../domain/services/auditService';
import {
  createBackup, listBackups, verifyBackup, prepareRestore,
  deleteBackup, getBackupDirectory, setBackupDirectory
} from '../../domain/services/backupService';
import { schemaVersion } from '../../domain/db/migrate';
import { setRestorePending } from '../restore';

/* ---------------- helpers ---------------- */

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function userOf(db: DB, token: string): SessionUser {
  const user = resolveSession(db, token);
  if (!user) throw new UnauthorizedError('সেশন স্ক্রুটি হয়ে গেছে। আবার লগইন করুন।');
  return user;
}

function asRange(r: Range): Range {
  if (!r || typeof r.from !== 'number' || typeof r.to !== 'number') {
    throw new ValidationError('সঠিক সময়সীমা দিন।');
  }
  return r;
}

/**
 * Idempotency wrapper: same (session, key, payload) replays the stored
 * result; same key with a different payload is rejected.
 */
function runIdempotent<T>(db: DB, user: SessionUser, key: string | undefined, payload: unknown, fn: () => T): T {
  if (!key) return fn();
  const payloadHash = sha256(JSON.stringify(payload ?? null));
  const existing = db
    .prepare('SELECT result, request_hash FROM idempotency_keys WHERE business_id = ? AND session_id = ? AND idem_key = ?')
    .get(user.businessId, user.sessionId, key) as { result: string; request_hash: string } | undefined;
  if (existing) {
    if (existing.request_hash !== payloadHash) {
      throw new ConflictError('এই রিকোয়েস্ট চাবিটি অন্য ডেটার সাথে আগে ব্যবহৃত হয়েছে। নতুন চাবির সাথে চেষ্টা করুন।');
    }
    return JSON.parse(existing.result) as T;
  }
  const result = fn();
  const serialized = JSON.stringify(result ?? null);
  try {
    db.prepare(
      `INSERT INTO idempotency_keys (id, business_id, session_id, idem_key, request_hash, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sha256(`${user.sessionId}:${key}:${payloadHash}`), user.businessId, user.sessionId, key,
      payloadHash, serialized, Date.now()
    );
  } catch {
    // UNIQUE collision = concurrent duplicate; re-read and replay
    const again = db
      .prepare('SELECT result FROM idempotency_keys WHERE business_id = ? AND session_id = ? AND idem_key = ?')
      .get(user.businessId, user.sessionId, key) as { result: string } | undefined;
    if (again) return JSON.parse(again.result) as T;
  }
  return result;
}

export function toIpcError(e: unknown): IpcError {
  if (e instanceof ValidationError) return { code: 'VALIDATION', message: e.message };
  if (e instanceof UnauthorizedError) return { code: 'UNAUTHORIZED', message: e.message };
  if (e instanceof NotFoundError) return { code: 'NOT_FOUND', message: e.message };
  if (e instanceof ConflictError) return { code: 'CONFLICT', message: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[merqo] unhandled IPC error:', e);
  return { code: 'INTERNAL', message: `অপ্রত্যাশিত ত্রুটি: ${msg}` };
}

type Raw = (user: SessionUser, args: unknown[]) => unknown;

interface HandlerDef {
  channel: string;
  auth: boolean;
  permission?: string;
  run: Raw;
}

/* ---------------- CSV export ---------------- */

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(db: DB, businessId: string, entity: string): string {
  const rows: string[] = [];
  const push = (...cells: unknown[]) => rows.push(cells.map(csvEscape).join(','));
  if (entity === 'products') {
    push('নাম', 'SKU', 'বারকোড', 'ক্যাটাগরি', 'ব্র্যান্ড', 'একক', 'খরচদাম', 'ভেদাম', 'স্টক');
    const prods = queryProducts(db, { businessId, limit: 100000, offset: 0 }).rows as unknown as Record<string, unknown>[];
    for (const p of prods) {
      const bar = (db.prepare('SELECT barcode FROM product_barcodes WHERE product_id = ? LIMIT 1').get(p.id as string) as { barcode: string } | undefined)?.barcode ?? '';
      push(p.name, p.sku, bar, p.category_name ?? '', p.brand_name ?? '', p.unit_name ?? '',
        (p.cost_paise as number) / 100, (p.price_paise as number) / 100, p.quantity ?? 0);
    }
  } else if (entity === 'customers') {
    push('নাম', 'ফোন', 'ঠিকানা', 'বকেয়া');
    for (const c of listCustomers(db, { businessId, limit: 100000 }).rows as Record<string, unknown>[]) {
      push(c.name, c.phone ?? '', c.address ?? '', (c.due_balance_paise as number) / 100);
    }
  } else if (entity === 'suppliers') {
    push('নাম', 'ফোন', 'ঠিকানা', 'দেয়াদায়ী');
    for (const s of listSuppliers(db, { businessId, limit: 100000 }).rows as Record<string, unknown>[]) {
      push(s.name, s.phone ?? '', s.address ?? '', (s.payable_balance_paise as number) / 100);
    }
  } else if (entity === 'sales') {
    push('রফারেন্স', 'তারিখ', 'কাস্টমার', 'পণ্য', 'মোট', 'পেমেন্ট', 'বকেয়া', 'স্ট্যাটাস');
    const { rows: sales } = querySales(db, { businessId, limit: 100000, offset: 0 } as never);
    for (const s of sales as Record<string, unknown>[]) {
      push(s.reference_no, new Date(s.date as number).toISOString().slice(0, 10),
        s.customer_name ?? 'হেঁচারি', (s.items as Record<string, unknown>[])?.map((i) => `${i.product_name}×${i.quantity}`).join(' + ') ?? '',
        (s.total_paise as number) / 100, (s.paid_paise as number) / 100, (s.due_paise as number) / 100, s.status);
    }
  } else if (entity === 'purchases') {
    push('রফারেন্স', 'তারিখ', 'সাপ্লায়ার', 'মোট', 'পেমেন্ট', 'বকেয়া', 'স্ট্যাটাস');
    const { rows: purchases } = queryPurchases(db, { businessId, limit: 100000, offset: 0 } as never);
    for (const p of purchases as Record<string, unknown>[]) {
      push(p.reference_no, new Date(p.date as number).toISOString().slice(0, 10),
        p.supplier_name ?? '', (p.total_paise as number) / 100, (p.paid_paise as number) / 100,
        (p.due_paise as number) / 100, p.status);
    }
  } else {
    throw new ValidationError('এই ডেটা এক্সপোর্ট করা যায় না।');
  }
  return rows.join('\r\n');
}

/* ---------------- handler definitions ---------------- */

export const HANDLERS: HandlerDef[] = [
  /* ---- auth (no session needed) ---- */
  {
    channel: IPC.AUTH_STATUS, auth: false,
    run: (_u, args) => {
      const b = getActiveBusiness(args[0] as DB);
      return { hasBusiness: !!b, business: b ? { id: b.id as string, name: b.name as string } : null };
    }
  },
  {
    channel: IPC.AUTH_LOGIN, auth: false,
    run: (_u, args) => {
      const db = args[0] as DB;
      const req = args[1] as { businessId: string; username: string; password: string };
      if (!getActiveBusiness(db)) throw new NotFoundError('ব্যবসা', '—');
      return login(db, req.businessId, req.username, req.password);
    }
  },
  {
    channel: IPC.AUTH_LOGOUT, auth: true,
    run: (user, args) => {
      logout(args[0] as DB, user.sessionId);
    }
  },
  {
    channel: IPC.AUTH_ME, auth: true,
    run: (user) => user
  },

  /* ---- setup / business / settings ---- */
  {
    channel: IPC.SETUP_CREATE, auth: false,
    run: (_u, args) => {
      const db = args[0] as DB;
      if (getActiveBusiness(db)) throw new ConflictError('এই ডাটাবেসে একটি ব্যবসা ইতিমধ্যে সেটআপ করা আছে।');
      return createBusiness(db, args[1] as never);
    }
  },
  {
    channel: IPC.BUSINESS_GET, auth: true,
    run: (user, args) => {
      const b = getBusiness(args[0] as DB, user.businessId);
      if (!b) throw new NotFoundError('ব্যবসা');
      return b;
    }
  },
  {
    channel: IPC.BUSINESS_UPDATE, auth: true, permission: 'settings.manage',
    run: (user, args) => {
      updateBusiness(args[0] as DB, user.businessId, args[1] as never, user.id);
    }
  },
  {
    channel: IPC.SETTINGS_GET, auth: true,
    run: (user, args) => {
      const [section, key, fallback] = args.slice(1) as [string, string, unknown];
      return getSetting(args[0] as DB, user.businessId, section, key, (fallback ?? null) as never);
    }
  },
  {
    channel: IPC.SETTINGS_SET, auth: true, permission: 'settings.manage',
    run: (user, args) => {
      const [section, key, value] = args.slice(1) as [string, string, unknown];
      setSetting(args[0] as DB, user.businessId, section, key, value, user.id);
    }
  },
  {
    channel: IPC.SETTINGS_SECTION, auth: true,
    run: (user, args) => getSectionSettings(args[0] as DB, user.businessId, args[1] as string)
  },
  {
    channel: IPC.SETTINGS_LIST, auth: true, permission: 'settings.manage',
    run: (user, args) => listAllSettings(args[0] as DB, user.businessId)
  },

  /* ---- dashboard / notifications ---- */
  {
    channel: IPC.DASHBOARD_GET, auth: true,
    run: (user, args) => getDashboard(args[0] as DB, user.businessId, args[1] as string)
  },
  {
    channel: IPC.NOTIFICATIONS_LIST, auth: true, permission: 'notifications.view',
    run: (user, args) => queryNotifications(args[0] as DB, { businessId: user.businessId, limit: (args[1] as number) ?? 30 }).rows
  },
  {
    channel: IPC.NOTIFICATIONS_UNREAD, auth: true, permission: 'notifications.view',
    run: (user, args) => unreadCount(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.NOTIFICATIONS_READ, auth: true, permission: 'notifications.view',
    run: (_u, args) => markRead(args[0] as DB, args[1] as string)
  },
  {
    channel: IPC.NOTIFICATIONS_READ_ALL, auth: true, permission: 'notifications.view',
    run: (user, args) => markAllRead(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.NOTIFICATIONS_DELETE, auth: true, permission: 'notifications.view',
    run: (_u, args) => deleteNotification(args[0] as DB, args[1] as string)
  },
  {
    channel: IPC.NOTIFICATIONS_SCAN, auth: true, permission: 'notifications.view',
    run: (user, args) => scanAndNotify(args[0] as DB, user.businessId)
  },

  /* ---- products ---- */
  {
    channel: IPC.PRODUCTS_QUERY, auth: true, permission: 'products.view',
    run: (user, args) => queryProducts(args[0] as DB, { businessId: user.businessId, ...(args[1] as object) })
  },
  {
    channel: IPC.PRODUCTS_GET, auth: true, permission: 'products.view',
    run: (user, args) => getProductDetail(args[0] as DB, user.businessId, args[1] as string) ?? null
  },
  {
    channel: IPC.PRODUCTS_BARCODE, auth: true, permission: 'products.view',
    run: (user, args) => findProductByBarcode(args[0] as DB, user.businessId, args[1] as string) ?? null
  },
  {
    channel: IPC.PRODUCTS_CREATE, auth: true, permission: 'products.create',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        createProduct(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },
  {
    channel: IPC.PRODUCTS_UPDATE, auth: true, permission: 'products.edit',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () => {
        const input = args[1] as { id: string; patch: Record<string, unknown>; priceChangeReason?: string; newBarcodes?: string[] };
        updateProductSafe(args[0] as DB, {
          businessId: user.businessId, userId: user.id,
          productId: input.id,
          patch: input.patch,
          newBarcodes: input.newBarcodes,
          priceChangeReason: input.priceChangeReason
        } as never);
        return null;
      })
  },
  {
    channel: IPC.PRODUCTS_DELETE, auth: true, permission: 'products.delete',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), [args[1]], () => {
        softDeleteProduct(args[0] as DB, { businessId: user.businessId, userId: user.id, productId: args[1] as string });
        return null;
      })
  },
  {
    channel: IPC.PRODUCTS_PRICE_HISTORY, auth: true, permission: 'products.view',
    run: (_u, args) => listPriceHistory(args[0] as DB, args[1] as string)
  },

  /* ---- master data ---- */
  {
    channel: IPC.MASTER_CATEGORIES_LIST, auth: true, permission: 'products.view',
    run: (user, args) => listCategories(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.MASTER_CATEGORIES_CREATE, auth: true, permission: 'products.edit',
    run: (user, args) => insertCategory(args[0] as DB, user.businessId, args[1] as string, 0, false)
  },
  {
    channel: IPC.MASTER_CATEGORIES_UPDATE, auth: true, permission: 'products.edit',
    run: (_u, args) => updateCategory(args[0] as DB, args[1] as string, args[2] as never)
  },
  {
    channel: IPC.MASTER_CATEGORIES_DELETE, auth: true, permission: 'products.edit',
    run: (_u, args) => deleteCategory(args[0] as DB, args[1] as string)
  },
  {
    channel: IPC.MASTER_BRANDS_LIST, auth: true, permission: 'products.view',
    run: (user, args) => listBrands(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.MASTER_BRANDS_CREATE, auth: true, permission: 'products.edit',
    run: (user, args) => insertBrand(args[0] as DB, user.businessId, args[1] as string)
  },
  {
    channel: IPC.MASTER_UNITS_LIST, auth: true, permission: 'products.view',
    run: (user, args) => listUnits(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.MASTER_UNITS_CREATE, auth: true, permission: 'products.edit',
    run: (user, args) => insertUnit(args[0] as DB, user.businessId, args[1] as string, args[2] as string, false)
  },

  /* ---- stock ---- */
  {
    channel: IPC.STOCK_ADJUST, auth: true, permission: 'stock.adjust',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        adjustStock(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },
  {
    channel: IPC.STOCK_MOVEMENTS, auth: true, permission: 'stock.view',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return movementHistory(args[0] as DB, user.businessId, q.productId as string | undefined, (q.limit as number) ?? 200, (q.offset as number) ?? 0);
    }
  },
  {
    channel: IPC.STOCK_SUMMARY, auth: true, permission: 'stock.view',
    run: (user, args) => inventorySummary(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.STOCK_RECONCILE, auth: true, permission: 'stock.view',
    run: (user, args) => reconcileInventory(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.STOCK_BATCHES, auth: true, permission: 'stock.view',
    run: (_u, args) => listActiveBatches(args[0] as DB, args[1] as string)
  },

  /* ---- sales ---- */
  {
    channel: IPC.SALES_CREATE, auth: true, permission: 'sales.create',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[1] as { idempotencyKey?: string }).idempotencyKey, args[1], () => {
        const req = args[1] as {
          lines: { productId: string; quantity: number; unitPricePaise?: number; discountPaise?: number; batchId?: string | null }[];
          payments: { method: string; amountPaise: number }[];
          customerId?: string | null; discountPaise?: number; note?: string; at?: number;
        };
        const res = createSale(args[0] as DB, {
          businessId: user.businessId, userId: user.id,
          lines: req.lines, payments: req.payments,
          customerId: req.customerId ?? null,
          discountPaise: req.discountPaise ?? 0,
          note: req.note ?? '', at: req.at
        } as never);
        return {
          id: res.saleId, referenceNo: res.referenceNo,
          totalPaise: res.totalPaise, paidPaise: res.paidPaise,
          changePaise: res.changePaise, duePaise: res.duePaise,
          cogsPaise: res.cogsPaise, grossProfitPaise: res.grossProfitPaise
        };
      })
  },
  {
    channel: IPC.SALES_GET, auth: true, permission: 'sales.view',
    run: (_u, args) => getSale(args[0] as DB, args[1] as string) ?? null
  },
  {
    channel: IPC.SALES_QUERY, auth: true, permission: 'sales.view',
    run: (user, args) => querySales(args[0] as DB, { businessId: user.businessId, ...(args[1] as object) } as never)
  },
  {
    channel: IPC.SALES_VOID, auth: true, permission: 'sales.void',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[3] as string | undefined), [args[1], args[2]], () => {
        voidSale(args[0] as DB, { businessId: user.businessId, saleId: args[1] as string, userId: user.id, reason: (args[2] as string) ?? '' });
        return null;
      })
  },
  {
    channel: IPC.SALES_HOLD, auth: true, permission: 'sales.hold',
    run: (user, args) => {
      const cart = (args[1] as { label?: string; items: unknown[]; customerId?: string | null }) ?? { items: [] };
      return holdSale(args[0] as DB, {
        businessId: user.businessId, userId: user.id,
        label: cart.label ?? '', items: cart.items as never, customerId: cart.customerId ?? null
      });
    }
  },
  {
    channel: IPC.SALES_HELD_LIST, auth: true, permission: 'sales.view',
    run: (user, args) => listHeldCarts(args[0] as DB, user.businessId, user.id)
  },
  {
    channel: IPC.SALES_HELD_RESUME, auth: true, permission: 'sales.view',
    run: (_u, args) => resumeHeldSale(args[0] as DB, args[1] as string)
  },
  {
    channel: IPC.SALES_HELD_CANCEL, auth: true, permission: 'sales.hold',
    run: (_u, args) => cancelHeldSale(args[0] as DB, args[1] as string)
  },
  {
    channel: IPC.SALES_RETURN_CREATE, auth: true, permission: 'sales.return',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        createSalesReturn(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },

  /* ---- purchases ---- */
  {
    channel: IPC.PURCHASES_CREATE, auth: true, permission: 'purchases.create',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[1] as { idempotencyKey?: string }).idempotencyKey, args[1], () => {
        const req = args[1] as {
          supplierId: string; supplierInvoiceNo?: string;
          lines: { productId: string; quantity: number; unitCostPaise: number; batchId?: string | null }[];
          payments: { method: string; amountPaise: number }[]; at?: number;
        };
        const res = createPurchase(args[0] as DB, {
          businessId: user.businessId, userId: user.id,
          supplierId: req.supplierId, supplierInvoiceNo: req.supplierInvoiceNo ?? '',
          lines: req.lines, payments: req.payments, at: req.at
        } as never);
        return { id: res.purchaseId, referenceNo: res.referenceNo, totalPaise: res.totalPaise, paidPaise: res.paidPaise, duePaise: res.duePaise };
      })
  },
  {
    channel: IPC.PURCHASES_GET, auth: true, permission: 'purchases.view',
    run: (_u, args) => getPurchase(args[0] as DB, args[1] as string) ?? null
  },
  {
    channel: IPC.PURCHASES_QUERY, auth: true, permission: 'purchases.view',
    run: (user, args) => queryPurchases(args[0] as DB, { businessId: user.businessId, ...(args[1] as object) } as never)
  },
  {
    channel: IPC.PURCHASES_RETURN_CREATE, auth: true, permission: 'purchases.return',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        createPurchaseReturn(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },

  /* ---- suppliers ---- */
  {
    channel: IPC.SUPPLIERS_LIST, auth: true, permission: 'suppliers.view',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return listSuppliers(args[0] as DB, {
        businessId: user.businessId,
        search: q.search as string | undefined,
        limit: (q.limit as number) ?? 500, offset: (q.offset as number) ?? 0,
        onlyWithPayable: q.onlyWithPayable as boolean | undefined
      }).rows;
    }
  },
  {
    channel: IPC.SUPPLIERS_GET, auth: true, permission: 'suppliers.view',
    run: (_u, args) => getSupplier(args[0] as DB, args[1] as string) ?? null
  },
  {
    channel: IPC.SUPPLIERS_CREATE, auth: true, permission: 'suppliers.manage',
    run: (user, args) =>
      createSupplier(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
  },
  {
    channel: IPC.SUPPLIERS_UPDATE, auth: true, permission: 'suppliers.manage',
    run: (user, args) => {
      const input = args[1] as { id: string; name?: string; phone?: string; address?: string; email?: string; isActive?: boolean };
      const { id, ...patch } = input;
      updateSupplier(args[0] as DB, id, patch, user.id);
    }
  },
  {
    channel: IPC.SUPPLIERS_PAY, auth: true, permission: 'suppliers.pay',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        paySupplier(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },
  {
    channel: IPC.SUPPLIERS_LEDGER, auth: true, permission: 'suppliers.view',
    run: (_u, args) => supplierLedger(args[0] as DB, args[1] as string)
  },

  /* ---- customers ---- */
  {
    channel: IPC.CUSTOMERS_LIST, auth: true, permission: 'customers.view',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return listCustomers(args[0] as DB, {
        businessId: user.businessId,
        search: q.search as string | undefined,
        limit: (q.limit as number) ?? 500, offset: (q.offset as number) ?? 0,
        onlyWithDue: q.onlyWithDue as boolean | undefined
      }).rows;
    }
  },
  {
    channel: IPC.CUSTOMERS_GET, auth: true, permission: 'customers.view',
    run: (_u, args) => getCustomer(args[0] as DB, args[1] as string) ?? null
  },
  {
    channel: IPC.CUSTOMERS_CREATE, auth: true, permission: 'customers.manage',
    run: (user, args) =>
      createCustomer(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
  },
  {
    channel: IPC.CUSTOMERS_UPDATE, auth: true, permission: 'customers.manage',
    run: (user, args) => {
      const input = args[1] as { id: string; name?: string; phone?: string; address?: string; email?: string; creditLimitPaise?: number; isActive?: boolean };
      const { id, ...patch } = input;
      updateCustomer(args[0] as DB, id, patch, user.id);
    }
  },
  {
    channel: IPC.CUSTOMERS_COLLECT, auth: true, permission: 'customers.collect',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        collectCustomerPayment(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },
  {
    channel: IPC.CUSTOMERS_LEDGER, auth: true, permission: 'customers.view',
    run: (_u, args) => customerLedger(args[0] as DB, args[1] as string)
  },

  /* ---- expenses ---- */
  {
    channel: IPC.EXPENSES_CREATE, auth: true, permission: 'expenses.create',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        createExpense(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },
  {
    channel: IPC.EXPENSES_GET, auth: true, permission: 'expenses.create',
    run: (_u, args) => getExpense(args[0] as DB, args[1] as string) ?? null
  },
  {
    channel: IPC.EXPENSES_LIST, auth: true, permission: 'expenses.create',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return listExpenses(args[0] as DB, {
        businessId: user.businessId,
        from: q.from as number | undefined, to: q.to as number | undefined,
        categoryId: q.categoryId as string | undefined,
        search: q.search as string | undefined,
        limit: (q.limit as number) ?? 100, offset: (q.offset as number) ?? 0
      });
    }
  },
  {
    channel: IPC.EXPENSES_CATEGORIES_LIST, auth: true, permission: 'expenses.create',
    run: (user, args) => listExpenseCategories(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.EXPENSES_CATEGORIES_CREATE, auth: true, permission: 'settings.manage',
    run: (user, args) => createExpenseCategory(args[0] as DB, user.businessId, args[1] as string, user.id)
  },

  /* ---- accounts ---- */
  {
    channel: IPC.ACCOUNTS_LIST, auth: true, permission: 'accounts.view',
    run: (user, args) => listAccounts(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.ACCOUNTS_TRANSACTIONS, auth: true, permission: 'accounts.view',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return accountTransactions(args[0] as DB, user.businessId, q.accountId as string | undefined, {
        from: q.from as number | undefined, to: q.to as number | undefined,
        limit: (q.limit as number) ?? 200, offset: (q.offset as number) ?? 0
      });
    }
  },
  {
    channel: IPC.ACCOUNTS_TRANSFER, auth: true, permission: 'accounts.transfer',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        transfer(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },

  /* ---- cash session (shift) ---- */
  {
    channel: IPC.SHIFT_OPEN, auth: true, permission: 'shift.open',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[1] as { idempotencyKey?: string }).idempotencyKey, args[1], () =>
        openShift(args[0] as DB, {
          businessId: user.businessId, userId: user.id,
          openingCashPaise: (args[1] as { openingCashPaise: number }).openingCashPaise,
          note: (args[1] as { note?: string }).note
        } as never)
      )
  },
  {
    channel: IPC.SHIFT_GET_OPEN, auth: true, permission: 'shift.open',
    run: (user, args) => getOpenShiftOne(args[0] as DB, user.businessId) ?? null
  },
  {
    channel: IPC.SHIFT_CASH_SUMMARY, auth: true, permission: 'shift.open',
    run: (user, args) => shiftCashSummary(args[0] as DB, user.businessId, args[1] as number, args[2] as number)
  },
  {
    channel: IPC.SHIFT_CLOSE, auth: true, permission: 'shift.close',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () => {
        const req = args[1] as { shiftId: string; actualCashPaise: number; note?: string };
        return closeShift(args[0] as DB, {
          businessId: user.businessId, shiftId: req.shiftId, userId: user.id,
          actualCashPaise: req.actualCashPaise, note: req.note ?? ''
        } as never);
      })
  },
  {
    channel: IPC.SHIFT_LIST, auth: true, permission: 'shift.close',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return listShifts(args[0] as DB, {
        businessId: user.businessId,
        from: q.from as number | undefined, to: q.to as number | undefined,
        limit: (q.limit as number) ?? 50, offset: (q.offset as number) ?? 0
      });
    }
  },
  {
    channel: IPC.SHIFT_DAILY_CLOSING, auth: true, permission: 'shift.close',
    run: (user, args) => dailyClosingReport(args[0] as DB, user.businessId)
  },

  /* ---- MFS agent ---- */
  {
    channel: IPC.MFS_PROVIDERS, auth: true, permission: 'mfs.view',
    run: (user, args) => listProviders(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.MFS_WALLET_SETUP, auth: true, permission: 'mfs.manage',
    run: (user, args) =>
      setupWallet(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
  },
  {
    channel: IPC.MFS_COMMISSION_LIST, auth: true, permission: 'mfs.view',
    run: (user, args) => listCommissionRules(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.MFS_COMMISSION_SAVE, auth: true, permission: 'mfs.manage',
    run: (user, args) =>
      saveCommissionRule(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
  },
  {
    channel: IPC.MFS_CREATE, auth: true, permission: 'mfs.create',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        createMfsTransaction(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },
  {
    channel: IPC.MFS_QUERY, auth: true, permission: 'mfs.view',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return queryMfsTransactions(args[0] as DB, {
        businessId: user.businessId, providerId: q.providerId as string | undefined,
        from: q.from as number | undefined, to: q.to as number | undefined,
        limit: (q.limit as number) ?? 50, offset: (q.offset as number) ?? 0
      });
    }
  },
  {
    channel: IPC.MFS_RECONCILIATION, auth: true, permission: 'mfs.view',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return mfsReconciliation(args[0] as DB, user.businessId, q.providerId as string, q.from as number | undefined, q.to as number | undefined);
    }
  },
  {
    channel: IPC.MFS_SUMMARY, auth: true, permission: 'mfs.view',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return mfsSummary(args[0] as DB, user.businessId, q.from as number | undefined, q.to as number | undefined);
    }
  },

  /* ---- reports ---- */
  {
    channel: IPC.REPORT_SALES_SUMMARY, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).salesSummary(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_SALES_BY_DAY, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).salesByDay(user.businessId, asRange(args[1] as Range), (args[2] as 'day' | 'week' | 'month') ?? 'day')
  },
  {
    channel: IPC.REPORT_SALES_BY_PAYMENT, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).salesByPaymentMethod(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_SALES_BY_PRODUCT, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).salesByProduct(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_SALES_BY_CATEGORY, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).salesByCategory(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_SALES_BY_CUSTOMER, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).salesByCustomer(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_SALES_BY_CASHIER, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).salesByCashier(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_PURCHASE_SUMMARY, auth: true, permission: 'purchases.view',
    run: (user, args) => createReports(args[0] as DB).purchaseSummary(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_PURCHASES_BY_SUPPLIER, auth: true, permission: 'purchases.view',
    run: (user, args) => createReports(args[0] as DB).purchasesBySupplier(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_PURCHASES_BY_PRODUCT, auth: true, permission: 'purchases.view',
    run: (user, args) => createReports(args[0] as DB).purchasesByProduct(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_STOCK_SUMMARY, auth: true, permission: 'stock.view',
    run: (user, args) => createReports(args[0] as DB).stockSummary(user.businessId)
  },
  {
    channel: IPC.REPORT_TOP_STOCK_VALUE, auth: true, permission: 'stock.viewCost',
    run: (user, args) => createReports(args[0] as DB).topStockValue(user.businessId)
  },
  {
    channel: IPC.REPORT_DEAD_STOCK, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).deadStock(user.businessId)
  },
  {
    channel: IPC.REPORT_FAST_MOVING, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).fastMoving(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_SLOW_MOVING, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).slowMoving(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_EXPIRING_BATCHES, auth: true, permission: 'stock.view',
    run: (user, args) => createReports(args[0] as DB).expiringBatches(user.businessId)
  },
  {
    channel: IPC.REPORT_DAMAGED_STOCK, auth: true, permission: 'stock.view',
    run: (user, args) => createReports(args[0] as DB).damagedStock(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_PROFIT_AND_LOSS, auth: true, permission: 'profit.view',
    run: (user, args) => createReports(args[0] as DB).profitAndLoss(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_EXPENSES_BY_CATEGORY, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).expensesByCategory(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_CASH_FLOW_BY_DAY, auth: true, permission: 'accounts.view',
    run: (user, args) => createReports(args[0] as DB).cashFlowByDay(user.businessId, asRange(args[1] as Range))
  },
  {
    channel: IPC.REPORT_ACCOUNT_BALANCE_SHEET, auth: true, permission: 'accounts.view',
    run: (user, args) => createReports(args[0] as DB).accountBalanceSheet(user.businessId)
  },
  {
    channel: IPC.REPORT_RECEIVABLE_PAYABLE, auth: true, permission: 'reports.view',
    run: (user, args) => createReports(args[0] as DB).receivablePayable(user.businessId)
  },
  {
    channel: IPC.REPORT_TOP_CUSTOMER_DUES, auth: true, permission: 'customers.view',
    run: (user, args) => createReports(args[0] as DB).topCustomerDues(user.businessId)
  },
  {
    channel: IPC.REPORT_TOP_SUPPLIER_PAYABLES, auth: true, permission: 'suppliers.view',
    run: (user, args) => createReports(args[0] as DB).topSupplierPayables(user.businessId)
  },
  {
    channel: IPC.REPORT_COLLECTIONS_BY_DAY, auth: true, permission: 'customers.view',
    run: (user, args) => createReports(args[0] as DB).collectionsByDay(user.businessId, asRange(args[1] as Range))
  },

  /* ---- import / export ---- */
  {
    channel: IPC.IMPORT_PREVIEW, auth: true, permission: 'imports.run',
    run: (user, args) => previewImport(args[0] as DB, { ...(args[1] as object), businessId: user.businessId } as never)
  },
  {
    channel: IPC.IMPORT_EXECUTE, auth: true, permission: 'imports.run',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        executeImport(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },
  {
    channel: IPC.IMPORT_JOBS, auth: true, permission: 'imports.run',
    run: (user, args) => listImportJobs(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.IMPORT_ERRORS, auth: true, permission: 'imports.run',
    run: (_u, args) => getImportErrors(args[0] as DB, args[1] as string)
  },
  {
    channel: IPC.EXPORT_CSV, auth: true, permission: 'exports.run',
    run: (user, args) => buildCsv(args[0] as DB, user.businessId, args[1] as string)
  },

  /* ---- users / roles / audit ---- */
  {
    channel: IPC.USERS_LIST, auth: true, permission: 'users.manage',
    run: (user, args) => listUsers(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.USERS_CREATE, auth: true, permission: 'users.manage',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () =>
        createUser(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, userId: user.id } as never)
      )
  },
  {
    channel: IPC.USERS_UPDATE, auth: true, permission: 'users.manage',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[2] as string | undefined), args[1], () => {
        updateUser(args[0] as DB, { ...(args[1] as object), businessId: user.businessId, adminUserId: user.id } as never);
        return null;
      })
  },
  {
    channel: IPC.USERS_CHANGE_PASSWORD, auth: true,
    run: (user, args) => {
      const db = args[0] as DB;
      const req = args[1] as { userId?: string; currentPassword?: string; newPassword: string };
      const targetId = req.userId ?? user.id;
      if (targetId !== user.id) requirePermission(user, 'users.manage');
      if (targetId === user.id && req.currentPassword === undefined) {
        throw new ValidationError('বর্তমান পাসওয়ার্ড দিন।');
      }
      if (req.currentPassword !== undefined) {
        const u = db.prepare('SELECT password_salt, password_hash FROM users WHERE id = ?').get(targetId) as
          { password_salt: string; password_hash: string } | undefined;
        if (!u) throw new NotFoundError('ব্যবহারকারী');
        if (!verifyPassword(req.currentPassword, u.password_salt, u.password_hash)) {
          throw new ValidationError('বর্তমান পাসওয়ার্ড সঠিক নয়।');
        }
      }
      changePassword(db, { businessId: user.businessId, userId: targetId, newPassword: req.newPassword, adminUserId: user.id });
    }
  },
  {
    channel: IPC.ROLES_LIST, auth: true, permission: 'users.manage',
    run: (user, args) => listRoles(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.ROLES_PERMISSIONS, auth: true, permission: 'users.manage',
    run: (_u, args) => getRolePermissions(args[0] as DB, args[1] as string)
  },
  {
    channel: IPC.ROLES_SET_PERMISSIONS, auth: true, permission: 'users.manage',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[3] as string | undefined), [args[1], args[2]], () => {
        setRolePermissions(args[0] as DB, args[1] as string, args[2] as string[], user.id);
        return null;
      })
  },
  {
    channel: IPC.AUDIT_QUERY, auth: true, permission: 'audit.view',
    run: (user, args) => {
      const q = (args[1] as Record<string, unknown>) ?? {};
      return queryAudit(args[0] as DB, {
        businessId: user.businessId,
        action: q.action as string | undefined,
        entityType: q.entityType as string | undefined,
        entityId: q.entityId as string | undefined,
        from: q.from as number | undefined, to: q.to as number | undefined,
        limit: (q.limit as number) ?? 100, offset: (q.offset as number) ?? 0
      });
    }
  },

  /* ---- search ---- */
  {
    channel: IPC.SEARCH_GLOBAL, auth: true,
    run: (user, args) => globalSearch(args[0] as DB, user.businessId, (args[1] as string) ?? '')
  },

  /* ---- backup ---- */
  {
    channel: IPC.BACKUP_CREATE, auth: true, permission: 'backup.create',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, (args[1] as string | undefined), ['manual'], () =>
        createBackup(args[0] as DB, { businessId: user.businessId, userId: user.id })
      )
  },
  {
    channel: IPC.BACKUP_LIST, auth: true, permission: 'backup.create',
    run: (user, args) => listBackups(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.BACKUP_VERIFY, auth: true, permission: 'backup.create',
    run: (user, args) => verifyBackup(args[0] as DB, user.businessId, args[1] as string)
  },
  {
    channel: IPC.BACKUP_RESTORE, auth: true, permission: 'backup.restore',
    run: (user, args) =>
      runIdempotent(args[0] as DB, user, `restore-${args[1] as string}`, [args[1]], () => {
        const tmp = prepareRestore(args[0] as DB, { businessId: user.businessId, userId: user.id, backupId: args[1] as string });
        setRestorePending(tmp);
        return { restartRequired: true };
      })
  },
  {
    channel: IPC.BACKUP_DELETE, auth: true, permission: 'backup.create',
    run: (user, args) =>
      deleteBackup(args[0] as DB, { businessId: user.businessId, userId: user.id, backupId: args[1] as string })
  },
  {
    channel: IPC.BACKUP_DIR_GET, auth: true, permission: 'backup.create',
    run: (user, args) => getBackupDirectory(args[0] as DB, user.businessId)
  },
  {
    channel: IPC.BACKUP_DIR_SET, auth: true, permission: 'settings.manage',
    run: (user, args) => setBackupDirectory(args[0] as DB, user.businessId, args[1] as string, user.id)
  }
];

/** Register all handlers against the live database. */
export function registerIpc(db: DB): void {
  for (const def of HANDLERS) {
    ipcMain.handle(def.channel, async (_event, token: string, ...rest: unknown[]) => {
      try {
        let user: SessionUser;
        if (def.auth) {
          user = userOf(db, token);
          if (def.permission) requirePermission(user, def.permission);
        } else {
          user = undefined as unknown as SessionUser;
        }
        const result = def.run(user, [db, ...rest]);
        return { ok: true as const, data: result };
      } catch (e) {
        return { ok: false as const, error: toIpcError(e) };
      }
    });
  }
}
