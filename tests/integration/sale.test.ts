import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, makeProduct, type TestEnv } from '../helpers';
import { createSale, voidSale, holdSale, listHeldCarts, resumeHeldSale, cancelHeldSale, getSale } from '../../src/domain/services/saleService';
import { createCustomer, collectCustomerPayment, customerLedger } from '../../src/domain/services/customerService';
import { createSalesReturn } from '../../src/domain/services/returnService';
import { getAccount, listAccounts, accountTransactions, recomputedBalance } from '../../src/domain/services/accountService';
import { getStock, reconcileInventory } from '../../src/domain/services/inventoryService';
import { ValidationError, InsufficientStockError, CreditLimitError } from '../../src/domain/errors';

let env: TestEnv;
const user = () => env.adminUserId;

beforeAll(() => {
  env = makeEnv({ openingCash: 10000000 }); // ৳1,00,000
});
afterAll(() => env.close());

function cashBalance() {
  const acc = listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')!;
  return (acc as unknown as { balance_paise: number }).balance_paise;
}

describe('sale → stock → payment → customer ledger (integration)', () => {
  it('creates a paid cash sale: stock deducted, cash credited, invoice numbered', () => {
    const product = makeProduct(env, { name: 'সুন্দর চিপস', sku: 'CHP-1', barcode: '8901001', cost: 4000, price: 6000, stock: 100 });
    const before = getStock(env.db, env.businessId, product);
    const cashBefore = cashBalance();

    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      lines: [{ productId: product, quantity: 10, unitPricePaise: 6000 }],
      payments: [{ method: 'cash', amountPaise: 60000 }]
    });

    expect(res.referenceNo).toBe('INV-000001');
    expect(res.totalPaise).toBe(60000);
    expect(res.paidPaise).toBe(60000);
    expect(res.duePaise).toBe(0);
    expect(res.changePaise).toBe(0);

    const after = getStock(env.db, env.businessId, product);
    expect(after.quantity).toBe(before.quantity - 10);
    expect(cashBalance()).toBe(cashBefore + 60000);

    const sale = getSale(env.db, env.businessId, res.saleId)!;
    expect(sale.items).toHaveLength(1);
    expect(sale.cogs_paise).toBe(10 * 4000); // ৳400 COGS @ ৳40 avg
  });

  it('handles change correctly (cash overpay)', () => {
    const product = makeProduct(env, { name: 'পানি', sku: 'WTR-1', cost: 10000, price: 20000, stock: 50 });
    const cashBefore = cashBalance();
    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      lines: [{ productId: product, quantity: 1 }],
      payments: [{ method: 'cash', amountPaise: 100000 }] // pay ৳1,000 for ৳200
    });
    expect(res.changePaise).toBe(80000);
    expect(res.paidPaise).toBe(20000);
    expect(cashBalance()).toBe(cashBefore + 20000); // net cash in
  });

  it('rejects change from a non-cash payment', () => {
    const product = makeProduct(env, { name: 'খাবার', sku: 'FOD-1', cost: 5000, price: 10000, stock: 10 });
    expect(() =>
      createSale(env.db, {
        businessId: env.businessId,
        userId: user(),
        lines: [{ productId: product, quantity: 1 }],
        payments: [{ method: 'bkash', amountPaise: 50000 }]
      })
    ).toThrow(ValidationError);
  });

  it('blocks negative stock by default', () => {
    const product = makeProduct(env, { name: 'দুধ', sku: 'MILK-1', cost: 8000, price: 10000, stock: 3 });
    expect(() =>
      createSale(env.db, {
        businessId: env.businessId,
        userId: user(),
        lines: [{ productId: product, quantity: 5 }],
        payments: [{ method: 'cash', amountPaise: 50000 }]
      })
    ).toThrow(InsufficientStockError);
    // stock unchanged after failed attempt (atomic rollback)
    expect(getStock(env.db, env.businessId, product).quantity).toBe(3);
  });

  it('credit sale updates customer receivable with correct due', () => {
    const customer = createCustomer(env.db, {
      businessId: env.businessId,
      name: 'রহিম মিয়া',
      phone: '01711111111',
      openingDuePaise: 10000,
      creditLimitPaise: 200000,
      userId: user()
    });
    const product = makeProduct(env, { name: 'চা', sku: 'TEA-1', cost: 60000, price: 100000, stock: 20 });

    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      customerId: customer,
      lines: [{ productId: product, quantity: 2 }],
      payments: [{ method: 'cash', amountPaise: 100000 }]
    });
    // total ৳2,000, paid ৳1,000 → due ৳1,000; previous due ৳100 → new ৳1,100
    expect(res.duePaise).toBe(100000);

    const cust = env.db.prepare('SELECT due_balance_paise FROM customers WHERE id = ?').get(customer) as { due_balance_paise: number };
    expect(cust.due_balance_paise).toBe(110000);

    const ledger = customerLedger(env.db, env.businessId, customer);
    expect(ledger).toHaveLength(2);
  });

  it('enforces credit limit without override, allows with override', () => {
    const customer = createCustomer(env.db, {
      businessId: env.businessId,
      name: 'করিম দাদা',
      creditLimitPaise: 50000,
      userId: user()
    });
    const product = makeProduct(env, { name: 'সিগারেট', sku: 'SIG-1', cost: 40000, price: 50000, stock: 100 });

    expect(() =>
      createSale(env.db, {
        businessId: env.businessId,
        userId: user(),
        customerId: customer,
        lines: [{ productId: product, quantity: 2 }], // ৳1,000 due > limit ৳500
        payments: []
      })
    ).toThrow(CreditLimitError);

    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      customerId: customer,
      lines: [{ productId: product, quantity: 2 }],
      payments: [],
      overrideCreditLimit: true
    });
    expect(res.duePaise).toBe(100000);
  });

  it('collects old due: cash in, due decreases, receipt numbered', () => {
    const customer = createCustomer(env.db, {
      businessId: env.businessId,
      name: 'আব্দুল করিম',
      openingDuePaise: 25000,
      userId: user()
    });
    const cashBefore = cashBalance();
    const res = collectCustomerPayment(env.db, {
      businessId: env.businessId,
      userId: user(),
      customerId: customer,
      amountPaise: 10000,
      method: 'cash'
    });
    expect(res.referenceNo).toMatch(/^CPY-\d{6}$/);
    expect(cashBalance()).toBe(cashBefore + 10000);
    const cust = env.db.prepare('SELECT due_balance_paise FROM customers WHERE id = ?').get(customer) as { due_balance_paise: number };
    expect(cust.due_balance_paise).toBe(15000);
  });

  it('rejects collection above due', () => {
    const customer = createCustomer(env.db, {
      businessId: env.businessId,
      name: 'হাসান',
      openingDuePaise: 1000,
      userId: user()
    });
    expect(() =>
      collectCustomerPayment(env.db, {
        businessId: env.businessId,
        userId: user(),
        customerId: customer,
        amountPaise: 2000,
        method: 'cash'
      })
    ).toThrow(ValidationError);
  });

  it('split payment: cash + bKash + bank validates to total', () => {
    const product = makeProduct(env, { name: 'আলমিরা', sku: 'FUR-1', cost: 80000, price: 100000, stock: 5 });
    const cashBefore = cashBalance();
    const bankAcc = listAccounts(env.db, env.businessId).find((a) => a.name === 'ব্যাংক')!;
    const bkashAcc = listAccounts(env.db, env.businessId).find((a) => a.name === 'bKash')!;
    const bankBefore = (bankAcc as unknown as { balance_paise: number }).balance_paise;
    const bkashBefore = (bkashAcc as unknown as { balance_paise: number }).balance_paise;

    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      lines: [{ productId: product, quantity: 1 }],
      payments: [
        { method: 'cash', amountPaise: 50000 },
        { method: 'bkash', amountPaise: 30000 },
        { method: 'bank', amountPaise: 20000 }
      ]
    });
    expect(res.totalPaise).toBe(100000);
    expect(res.paidPaise).toBe(100000);
    expect(cashBalance()).toBe(cashBefore + 50000);
    expect((listAccounts(env.db, env.businessId).find((a) => a.id === bankAcc.id) as unknown as { balance_paise: number }).balance_paise).toBe(bankBefore + 20000);
    expect((listAccounts(env.db, env.businessId).find((a) => a.id === bkashAcc.id) as unknown as { balance_paise: number }).balance_paise).toBe(bkashBefore + 30000);
  });

  it('void sale: restocks, reverses cash, reverses customer due, keeps number', () => {
    const customer = createCustomer(env.db, {
      businessId: env.businessId,
      name: 'মানিক',
      userId: user()
    });
    const product = makeProduct(env, { name: 'সাবান', sku: 'SAB-1', cost: 2000, price: 3000, stock: 50 });
    const cashBefore = cashBalance();
    const stockBefore = getStock(env.db, env.businessId, product).quantity;

    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      customerId: customer,
      lines: [{ productId: product, quantity: 4 }],
      payments: [{ method: 'cash', amountPaise: 5000 }]
    });
    expect(res.duePaise).toBe(7000);

    voidSale(env.db, { businessId: env.businessId, saleId: res.saleId, userId: user(), reason: 'ভুল বিক্রয়' });

    const sale = getSale(env.db, env.businessId, res.saleId)!;
    expect(sale.status).toBe('voided');
    expect(getStock(env.db, env.businessId, product).quantity).toBe(stockBefore);
    expect(cashBalance()).toBe(cashBefore);
    const cust = env.db.prepare('SELECT due_balance_paise FROM customers WHERE id = ?').get(customer) as { due_balance_paise: number };
    expect(cust.due_balance_paise).toBe(0);
  });

  it('sales return on a credit sale splits between due and cash (settlement)', () => {
    const customer = createCustomer(env.db, {
      businessId: env.businessId,
      name: 'নাছিম',
      creditLimitPaise: 1000000,
      userId: user()
    });
    const product = makeProduct(env, { name: 'মুরগি', sku: 'CHK-1', cost: 60000, price: 100000, stock: 20 });
    const cashBefore = cashBalance();
    const stockBefore = getStock(env.db, env.businessId, product).quantity;

    // Total ৳2,000, paid ৳500 cash → due ৳1,500 on the sale
    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      customerId: customer,
      lines: [{ productId: product, quantity: 2 }],
      payments: [{ method: 'cash', amountPaise: 50000 }]
    });
    expect(res.duePaise).toBe(150000);
    const detail = getSale(env.db, env.businessId, res.saleId)!;

    // First return (1 unit = ৳1,000): customer has due, so it settles
    // entirely against the receivable — no cash moves, due drops by ৳1,000.
    const r1 = createSalesReturn(env.db, {
      businessId: env.businessId,
      userId: user(),
      saleId: res.saleId,
      reason: 'গুণগত মান সমস্যা',
      items: [{ saleItemId: detail.items[0].id, quantity: 1, restock: true }]
    });
    expect(r1.method).toBe('receivable');
    expect(r1.totalRefundPaise).toBe(100000);
    expect(r1.receivableReductionPaise).toBe(100000);
    expect(r1.accountRefundPaise).toBe(0);
    expect(cashBalance()).toBe(cashBefore + 50000); // unchanged by the return
    expect(getSale(env.db, env.businessId, res.saleId)!.due_paise).toBe(50000);
    expect(getStock(env.db, env.businessId, product).quantity).toBe(stockBefore - 1);

    // Second return (last unit = ৳1,000): only ৳500 of due remains, so
    // ৳500 settles the due and the pre-paid ৳500 comes back from cash.
    const r2 = createSalesReturn(env.db, {
      businessId: env.businessId,
      userId: user(),
      saleId: res.saleId,
      reason: 'ব্যাল ভাঙা',
      items: [{ saleItemId: detail.items[0].id, quantity: 1, restock: true }]
    });
    expect(r2.method).toBe('receivable');
    expect(r2.totalRefundPaise).toBe(100000);
    expect(r2.receivableReductionPaise).toBe(50000);
    expect(r2.accountRefundPaise).toBe(50000);
    // cash: +50000 (original payment) - 50000 (refund) = back to start
    expect(cashBalance()).toBe(cashBefore);
    expect(getSale(env.db, env.businessId, res.saleId)!.due_paise).toBe(0);
    expect(getSale(env.db, env.businessId, res.saleId)!.status).toBe('refunded');
    expect(getStock(env.db, env.businessId, product).quantity).toBe(stockBefore);

    const cust = env.db.prepare('SELECT due_balance_paise FROM customers WHERE id = ?').get(customer) as { due_balance_paise: number };
    expect(cust.due_balance_paise).toBe(0);
  });

  it('holds and resumes carts', () => {
    const product = makeProduct(env, { name: 'বিস্কুট', sku: 'BSC-1', cost: 1500, price: 2000, stock: 10 });
    const id = holdSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      label: 'রহিমের',
      items: [{ productId: product, quantity: 2 }]
    });
    expect(listHeldCarts(env.db, env.businessId, user())).toHaveLength(1);
    const resumed = resumeHeldSale(env.db, env.businessId, id)!;
    expect(resumed.items[0].productId).toBe(product);
    expect(listHeldCarts(env.db, env.businessId, user())).toHaveLength(0);
    cancelHeldSale(env.db, env.businessId, id);
  });

  it('all account balances reconcile with their ledgers', () => {
    for (const acc of listAccounts(env.db, env.businessId)) {
      const a = acc as unknown as { id: string };
      const recomputed = recomputedBalance(env.db, a.id);
      const actual = (getAccount(env.db, env.businessId, a.id) as unknown as { balance_paise: number }).balance_paise;
      expect(recomputed, `account ${a.id}`).toBe(actual);
    }
  });

  it('inventory reconciles with movements', () => {
    const r = reconcileInventory(env.db, env.businessId);
    expect(r.ok).toBe(true);
  });

  it('account transactions ledger has rows for the sale', () => {
    const rows = accountTransactions(env.db, env.businessId);
    expect(rows.length).toBeGreaterThan(0);
  });
});
