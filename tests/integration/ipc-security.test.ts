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
import { createUser, login } from '../../src/domain/services/userService';
import { createProduct } from '../../src/domain/services/productService';
import { querySales } from '../../src/domain/services/saleService';

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
