/**
 * IPC security (RC: permission matrix + bypass tests).
 *
 * Drives the SAME dispatchIpc() path the Electron bridge uses, with real
 * sessions for each role:
 *  - a low-privilege token can never reach a handler it lacks permission for
 *  - the permission gate fires BEFORE any domain code runs (verified with a
 *    non-existent entity: DENIED ≠ NOT_FOUND)
 *  - invalid/expired tokens are rejected
 *  - double submission (idempotency key) is safe at this boundary
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, makeProduct, type TestEnv } from '../helpers';
import { dispatchIpc, type IpcResult } from '../../src/main/ipc/handlers';
import { IPC, type IpcError } from '../../src/shared/ipc';
import { createUser, login, getRolePermissions } from '../../src/domain/services/userService';
import { createProduct } from '../../src/domain/services/productService';
import { querySales } from '../../src/domain/services/saleService';
import { createCustomer } from '../../src/domain/services/customerService';
import { createReports } from '../../src/domain/services/reportService';
import { resolveRange } from '../../src/shared/dates';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

let env: TestEnv;
let adminToken: string;
let cashierToken: string;
let managerToken: string;

function err(r: IpcResult): IpcError {
  if (r.ok) throw new Error('expected an IPC error');
  return r.error;
}

beforeAll(() => {
  env = makeEnv({ openingCash: 100000000 });
  adminToken = env.login().token;

  // role users (passwords ≥ 4 chars)
  createUser(env.db, {
    businessId: env.businessId, name: 'ক্যাশিয়ার টেস্ট', username: 'cashier1',
    password: 'cash1234', roleKey: 'cashier', userId: env.adminUserId
  });
  createUser(env.db, {
    businessId: env.businessId, name: 'ম্যানেজার টেস্ট', username: 'manager1',
    password: 'mgr12345', roleKey: 'manager', userId: env.adminUserId
  });
  cashierToken = login(env.db, env.businessId, 'cashier1', 'cash1234').token;
  managerToken = login(env.db, env.businessId, 'manager1', 'mgr12345').token;
});
afterAll(() => env.close());

describe('IPC session & permission enforcement', () => {
  it('rejects an unknown token', () => {
    const r = dispatchIpc(env.db, IPC.SALES_CREATE, 'no-such-token', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a token from a logged-out session', () => {
    const t = env.login().token;
    // AUTH_LOGOUT ends the session
    const out = dispatchIpc(env.db, IPC.AUTH_LOGOUT, t);
    expect(out.ok).toBe(true);
    const r = dispatchIpc(env.db, IPC.SALES_QUERY, t, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNAUTHORIZED');
  });

  it('cashier cannot void a sale (gate fires before domain)', () => {
    // Fake sale id: if the gate leaked, the domain would answer NOT_FOUND;
    // the correct answer is PERMISSION_DENIED.
    const r = dispatchIpc(env.db, IPC.SALES_VOID, cashierToken, 'no-such-sale', 'কারণ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PERMISSION_DENIED');
  });

  it('manager passes the gate (domain then answers NOT_FOUND)', () => {
    const r = dispatchIpc(env.db, IPC.SALES_VOID, managerToken, 'no-such-sale', 'কারণ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('cashier cannot manage users or see profit reports', () => {
    expect(err(dispatchIpc(env.db, IPC.USERS_LIST, cashierToken)).code).toBe('PERMISSION_DENIED');
    expect(err(dispatchIpc(env.db, IPC.REPORT_PROFIT_AND_LOSS, cashierToken, { from: 0, to: 9999999999999 })).code).toBe('PERMISSION_DENIED');
    expect(err(dispatchIpc(env.db, IPC.BACKUP_CREATE, cashierToken)).code).toBe('PERMISSION_DENIED');
    expect(err(dispatchIpc(env.db, IPC.REPORT_TOP_STOCK_VALUE, cashierToken)).code).toBe('PERMISSION_DENIED');
  });

  it('manager can void but cannot manage users or restore backups', () => {
    expect(err(dispatchIpc(env.db, IPC.USERS_LIST, managerToken)).code).toBe('PERMISSION_DENIED');
    expect(err(dispatchIpc(env.db, IPC.BACKUP_RESTORE, managerToken, 'no-backup')).code).toBe('PERMISSION_DENIED');
  });

  it('cashier CAN do its job: create sales, list products, collect dues', () => {
    const p = makeProduct(env, { name: 'সিকিউরিটি পণ্য', sku: 'SEC-1', price: 5000, stock: 10 });
    const r = dispatchIpc(env.db, IPC.SALES_CREATE, cashierToken, {
      lines: [{ productId: p, quantity: 1 }],
      payments: [{ method: 'cash', amountPaise: 5000 }],
      idempotencyKey: 'sec-key-1'
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const res = r.data as { referenceNo: string };
      expect(res.referenceNo).toMatch(/^INV-/);
    }
    expect(dispatchIpc(env.db, IPC.PRODUCTS_QUERY, cashierToken, {}).ok).toBe(true);
    expect(dispatchIpc(env.db, IPC.STOCK_SUMMARY, cashierToken).ok).toBe(true);
  });

  it('domain price-override flag comes from the session role, not the client', () => {
    // Cashier HAS sales.priceOverride by default role — use inventory_manager
    // (no sales.create at all) to prove the channel is simply closed.
    createUser(env.db, {
      businessId: env.businessId, name: 'ইনভেন্টরি টেস্ট', username: 'inv1',
      password: 'inv12345', roleKey: 'inventory_manager', userId: env.adminUserId
    });
    const invToken = login(env.db, env.businessId, 'inv1', 'inv12345').token;
    const p = makeProduct(env, { name: 'ইনভ পণ্য', sku: 'INV-SEC-1', price: 8000, stock: 10 });
    const r = dispatchIpc(env.db, IPC.SALES_CREATE, invToken, {
      lines: [{ productId: p, quantity: 1 }],
      payments: [{ method: 'cash', amountPaise: 8000 }]
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('double submission (idempotency at the IPC boundary)', () => {
  const salePayload = (key: string) => ({
    lines: [{ productId: PRODUCT, quantity: 2 }],
    payments: [{ method: 'cash', amountPaise: 10000 }],
    idempotencyKey: key
  });
  let PRODUCT: string;

  it('same key + same payload → one sale, replayed result', () => {
    PRODUCT = makeProduct(env, { name: 'ডাবল-সাবমিশন', sku: 'DBL-1', price: 5000, stock: 100 });
    const key = 'double-key-1';
    const r1 = dispatchIpc(env.db, IPC.SALES_CREATE, adminToken, salePayload(key));
    const r2 = dispatchIpc(env.db, IPC.SALES_CREATE, adminToken, salePayload(key));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) throw new Error('expected ok results');
    const a = r1.data as { referenceNo: string; totalPaise: number };
    const b = r2.data as { referenceNo: string; totalPaise: number };
    expect(b.referenceNo).toBe(a.referenceNo);
    expect(b.totalPaise).toBe(a.totalPaise);
    // exactly ONE sale row exists for this key
    const sales = querySales(env.db, { businessId: env.businessId, limit: 500 } as never).rows;
    const matches = (sales as Record<string, unknown>[]).filter(
      (s) => (s as { reference_no?: string }).reference_no === a.referenceNo
    );
    expect(matches).toHaveLength(1);
  });

  it('same key + different payload → CONFLICT, no second sale', () => {
    const key = 'double-key-2';
    const r1 = dispatchIpc(env.db, IPC.SALES_CREATE, adminToken, salePayload(key));
    expect(r1.ok).toBe(true);
    const r2 = dispatchIpc(env.db, IPC.SALES_CREATE, adminToken, {
      ...salePayload(key),
      payments: [{ method: 'cash', amountPaise: 99999 }]
    });
    expect(r2.ok).toBe(false);
    if (r2.ok) throw new Error('expected conflict');
    expect(r2.error.code).toBe('CONFLICT');
  });

  it('no key → both requests execute (client chose non-idempotent mode)', () => {
    const p = makeProduct(env, { name: 'নন-ইডেম', sku: 'NID-1', price: 2000, stock: 100 });
    const payload = { lines: [{ productId: p, quantity: 1 }], payments: [{ method: 'cash', amountPaise: 2000 }] };
    const r1 = dispatchIpc(env.db, IPC.SALES_CREATE, adminToken, payload);
    const r2 = dispatchIpc(env.db, IPC.SALES_CREATE, adminToken, payload);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });
});

describe('phase-16: full permission matrix at the IPC boundary', () => {
  it('dashboard masks profit/cost/balance fields per session permission', () => {
    const p = makeProduct(env, { name: 'লাভ পণ্য', sku: 'PROF-1', cost: 3000, price: 5000, stock: 10 });
    const sale = dispatchIpc(env.db, IPC.SALES_CREATE, adminToken, {
      lines: [{ productId: p, quantity: 1 }],
      payments: [{ method: 'cash', amountPaise: 5000 }],
      idempotencyKey: 'phase16-profit'
    });
    expect(sale.ok).toBe(true);

    type Dash = {
      kpis: { todayProfit: number; cashBalance: number; stockValue: number };
      profitTrend: unknown[];
      topProducts: { profit: number }[];
    };
    const mgr = dispatchIpc(env.db, IPC.DASHBOARD_GET, managerToken, 'today');
    expect(mgr.ok).toBe(true);
    if (!mgr.ok) throw new Error('manager dashboard should pass');
    const m = mgr.data as Dash;
    // Manager sees the domain's own P&L figure (sign depends on earlier
    // test sales, so compare against the report, not against zero)
    const expected = createReports(env.db).profitAndLoss(env.businessId, resolveRange('today', Date.now())).netProfit;
    expect(expected).not.toBe(0); // sanity: masking is only meaningful vs non-zero
    expect(m.kpis.todayProfit).toBe(expected);
    expect(m.kpis.cashBalance).toBeGreaterThan(0);
    expect(m.kpis.stockValue).toBeGreaterThan(0);
    expect(m.profitTrend.length).toBeGreaterThan(0);

    const cash = dispatchIpc(env.db, IPC.DASHBOARD_GET, cashierToken, 'today');
    expect(cash.ok).toBe(true);
    if (!cash.ok) throw new Error('cashier dashboard should pass');
    const c = cash.data as Dash;
    // cashier: no profit.view / accounts.view / stock.viewCost → masked
    expect(c.kpis.todayProfit).toBe(0);
    expect(c.kpis.cashBalance).toBe(0);
    expect(c.kpis.stockValue).toBe(0);
    expect(c.profitTrend).toHaveLength(0);
    for (const tp of c.topProducts) expect(tp.profit).toBe(0);
  });

  it('sale flags (discount / price-override) are derived from the role, not the client', () => {
    const roles = env.db
      .prepare('SELECT id FROM roles WHERE business_id = ? AND key = ?')
      .all(env.businessId, 'cashier') as { id: string }[];
    const cashierRoleId = roles[0].id;
    const current = getRolePermissions(env.db, env.businessId, cashierRoleId);
    try {
      const narrowed = current.filter((p) => p !== 'sales.discount' && p !== 'sales.priceOverride');
      const set = dispatchIpc(env.db, IPC.ROLES_SET_PERMISSIONS, adminToken, cashierRoleId, narrowed);
      expect(set.ok).toBe(true);

      const p = makeProduct(env, { name: 'ফ্ল্যাগ পণ্য', sku: 'FLAG-1', price: 5000, minPrice: 4000, stock: 10 });
      // Client "requests" a discount — server must still strip the flag
      const r1 = dispatchIpc(env.db, IPC.SALES_CREATE, cashierToken, {
        lines: [{ productId: p, quantity: 1, discountPaise: 500 }],
        payments: [{ method: 'cash', amountPaise: 4500 }],
        idempotencyKey: 'phase16-disc'
      });
      expect(r1.ok).toBe(false);
      if (!r1.ok) {
        expect(r1.error.code).toBe('VALIDATION');
        expect(r1.error.message).toContain('ছাড়');
      }
      // Client "requests" a below-minimum price — server must still strip the flag
      const r2 = dispatchIpc(env.db, IPC.SALES_CREATE, cashierToken, {
        lines: [{ productId: p, quantity: 1, unitPricePaise: 3000 }],
        payments: [{ method: 'cash', amountPaise: 3000 }],
        idempotencyKey: 'phase16-price'
      });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.error.code).toBe('VALIDATION');
    } finally {
      const restore = dispatchIpc(env.db, IPC.ROLES_SET_PERMISSIONS, adminToken, cashierRoleId, current);
      expect(restore.ok).toBe(true);
    }
  });

  it('credit-limit override is stripped for a role without sales.creditOverride', () => {
    const custId = createCustomer(env.db, {
      businessId: env.businessId, userId: env.adminUserId,
      name: 'ক্রেডিট কাস্টমার', phone: '01700000111', creditLimitPaise: 3000
    });
    const p = makeProduct(env, { name: 'ক্রেডিট পণ্য', sku: 'CRD-1', price: 5000, stock: 10 });
    // cashier role has no sales.creditOverride → the client flag must be ignored
    const r = dispatchIpc(env.db, IPC.SALES_CREATE, cashierToken, {
      lines: [{ productId: p, quantity: 1 }],
      payments: [{ method: 'cash', amountPaise: 1000 }],
      customerId: custId,
      overrideCreditLimit: true,
      idempotencyKey: 'phase16-credit'
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CREDIT_LIMIT');
  });

  it('cost-based dead-stock report requires stock.viewCost', () => {
    createUser(env.db, {
      businessId: env.businessId, name: 'অ্যাকাউন্ট্যান্ট টেস্ট', username: 'acc1',
      password: 'acc12345', roleKey: 'accountant', userId: env.adminUserId
    });
    const accToken = login(env.db, env.businessId, 'acc1', 'acc12345').token;
    // accountant has reports.view but NOT stock.viewCost
    expect(err(dispatchIpc(env.db, IPC.REPORT_DEAD_STOCK, accToken)).code).toBe('PERMISSION_DENIED');
    // manager has stock.viewCost → passes (empty list is fine)
    const ok = dispatchIpc(env.db, IPC.REPORT_DEAD_STOCK, managerToken);
    expect(ok.ok).toBe(true);
  });

  it('audit / settings / stock-adjust gates per role', () => {
    // 'acc1' was created in the dead-stock test above (file runs sequentially)
    const accToken = login(env.db, env.businessId, 'acc1', 'acc12345').token;
    // audit: accountant denied, manager allowed
    expect(err(dispatchIpc(env.db, IPC.AUDIT_QUERY, accToken, {})).code).toBe('PERMISSION_DENIED');
    expect(dispatchIpc(env.db, IPC.AUDIT_QUERY, managerToken, {}).ok).toBe(true);
    // settings: cashier denied, manager allowed
    expect(err(dispatchIpc(env.db, IPC.SETTINGS_SET, cashierToken, 'pos', 'default_paper', '80mm')).code).toBe('PERMISSION_DENIED');
    const set = dispatchIpc(env.db, IPC.SETTINGS_SET, managerToken, 'pos', 'default_paper', '80mm');
    expect(set.ok).toBe(true);
    // stock adjust: cashier denied; inventory_manager passes the gate (domain answers)
    expect(err(dispatchIpc(env.db, IPC.STOCK_ADJUST, cashierToken, { productId: 'nope', quantity: 1, reason: 'x' })).code).toBe('PERMISSION_DENIED');
    createUser(env.db, {
      businessId: env.businessId, name: 'ইনভ২', username: 'inv2',
      password: 'inv23456', roleKey: 'inventory_manager', userId: env.adminUserId
    });
    const invToken = login(env.db, env.businessId, 'inv2', 'inv23456').token;
    const adj = dispatchIpc(env.db, IPC.STOCK_ADJUST, invToken, { productId: 'nope', quantity: 1, reason: 'x' });
    expect(adj.ok).toBe(false);
    if (!adj.ok) expect(['NOT_FOUND', 'VALIDATION']).toContain(adj.error.code);
  });

  it('backup: manager can create but never restore; owner restores end-to-end', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'merqo-qa-'));
    try {
      expect(dispatchIpc(env.db, IPC.BACKUP_DIR_SET, adminToken, dir).ok).toBe(true);
      // manager: backup.create yes, backup.restore no (excluded from the role)
      expect(dispatchIpc(env.db, IPC.BACKUP_CREATE, managerToken).ok).toBe(true);
      expect(err(dispatchIpc(env.db, IPC.BACKUP_RESTORE, managerToken, 'whatever')).code).toBe('PERMISSION_DENIED');
      // cashier: neither
      expect(err(dispatchIpc(env.db, IPC.BACKUP_CREATE, cashierToken)).code).toBe('PERMISSION_DENIED');
      // owner: full flow
      const created = dispatchIpc(env.db, IPC.BACKUP_CREATE, adminToken);
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('backup create failed');
      const backupId = (created.data as { id: string }).id;
      const restored = dispatchIpc(env.db, IPC.BACKUP_RESTORE, adminToken, backupId);
      expect(restored.ok).toBe(true);
      if (restored.ok) expect((restored.data as { restartRequired: boolean }).restartRequired).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
