/**
 * End-to-end "real shop day" simulation (§132).
 *
 * 1. Open shift  2. Receive products  3. Sell by barcode  4. Cash sale
 * 5. MFS payment 6. Credit sale  7. Collect old due  8. Pay supplier
 * 9. Record expense  10. Process return  11. Close shift
 * 12. Verify: every ledger and balance reconciles.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, makeProduct, type TestEnv } from '../helpers';
import { openShift, closeShift, getOpenShiftOne, dailyClosingReport, shiftCashSummary } from '../../src/domain/services/cashSessionService';
import { createPurchase, getPurchase } from '../../src/domain/services/purchaseService';
import { createSupplier, paySupplier } from '../../src/domain/services/supplierService';
import { createSale, getSale } from '../../src/domain/services/saleService';
import { findProductByBarcode } from '../../src/domain/repos/master';
import { createCustomer, collectCustomerPayment } from '../../src/domain/services/customerService';
import { createExpense, listExpenseCategories } from '../../src/domain/services/expenseService';
import { createSalesReturn, createPurchaseReturn } from '../../src/domain/services/returnService';
import { createMfsTransaction, listProviders } from '../../src/domain/services/mfsService';
import { listAccounts, recomputedBalance } from '../../src/domain/services/accountService';
import { getStock, reconcileInventory } from '../../src/domain/services/inventoryService';
import { createReports } from '../../src/domain/services/reportService';
import { startOfDayLocal, endOfDayLocal } from '../../src/shared/dates';

let env: TestEnv;
const user = () => env.adminUserId;
const reports = () => createReports(env.db);
const today = () => ({ from: startOfDayLocal(Date.now()), to: endOfDayLocal(Date.now()) });

beforeAll(() => {
  env = makeEnv({ openingCash: 5000000 }); // ৳50,000
});
afterAll(() => env.close());

describe('a complete shop day, everything must reconcile', () => {
  let supplierId: string;
  let productA: string; // চিপস ৳20 cost / ৳30 sell
  let productB: string; // চকলেট ৳50 cost / ৳80 sell
  let customer: string;
  let shiftId: string;

  it('1. opens the shift with opening cash ৳50,000', () => {
    const res = openShift(env.db, { businessId: env.businessId, userId: user(), openingCashPaise: 5000000 });
    shiftId = res.id;
    expect(res.referenceNo).toMatch(/^SHIFT-\d{6}$/);
    const open = getOpenShiftOne(env.db, env.businessId)!;
    expect(open.opening_cash_paise).toBe(5000000);
  });

  it('2. receives stock from supplier (partial payment → payable)', () => {
    supplierId = createSupplier(env.db, { businessId: env.businessId, name: 'মেঘনা ডিস্ট্রিবিউটর', phone: '09611111111', userId: user() });
    productA = makeProduct(env, { name: 'চিপস (৩০ পয়সা)', sku: 'CHIP-30', barcode: '8901000001', cost: 0, price: 3000, stock: 0 });
    productB = makeProduct(env, { name: 'চকলেট', sku: 'CHOC-80', barcode: '8901000002', cost: 0, price: 8000, stock: 0 });
    const res = createPurchase(env.db, {
      businessId: env.businessId,
      userId: user(),
      supplierId,
      supplierInvoiceNo: 'MD-101',
      lines: [
        { productId: productA, quantity: 200, unitCostPaise: 2000 },
        { productId: productB, quantity: 100, unitCostPaise: 5000 }
      ],
      payments: [{ method: 'cash', amountPaise: 200000 }] // ৳2,000 of ৳9,000
    });
    expect(res.totalPaise).toBe(200 * 2000 + 100 * 5000); // ৳9,000
    expect(res.duePaise).toBe(700000);
    expect(getStock(env.db, env.businessId, productA).quantity).toBe(200);
    expect(getStock(env.db, env.businessId, productB).quantity).toBe(100);
    const sup = env.db.prepare('SELECT payable_balance_paise FROM suppliers WHERE id = ?').get(supplierId) as { payable_balance_paise: number };
    expect(sup.payable_balance_paise).toBe(700000);
  });

  it('3. sells products by barcode lookup', () => {
    const found = findProductByBarcode(env.db, env.businessId, '8901000001');
    expect(found?.name).toBe('চিপস (৩০ পয়সা)');
    expect(found?.id).toBe(productA);
  });

  it('4. cash sale of ৩০ items (৳900)', () => {
    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      lines: [{ productId: productA, quantity: 30 }],
      payments: [{ method: 'cash', amountPaise: 90000 }]
    });
    expect(res.totalPaise).toBe(90000);
    expect(res.changePaise).toBe(0);
  });

  it('5. split sale with MFS + cash (৳1,000 = ৬০০ bKash + ৪০০ cash)', () => {
    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      lines: [{ productId: productB, quantity: 10, unitPricePaise: 8000 }],
      payments: [
        { method: 'bkash', amountPaise: 60000 },
        { method: 'cash', amountPaise: 40000 }
      ]
    });
    expect(res.totalPaise).toBe(80000);
    expect(res.paidPaise).toBe(80000);
  });

  it('6. credit sale for a customer (৳500, paid ২০০)', () => {
    customer = createCustomer(env.db, {
      businessId: env.businessId, name: 'মুস্তাফা কামাল', phone: '01812345678',
      openingDuePaise: 3000, userId: user()
    });
    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      customerId: customer,
      lines: [{ productId: productA, quantity: 10 }], // ৳300... make it ৳500: use B
      payments: [{ method: 'cash', amountPaise: 20000 }]
    });
    // 10 × ৳30 = ৳300; paid ৳200 → due ৳100
    expect(res.duePaise).toBe(10000);
    const c = env.db.prepare('SELECT due_balance_paise FROM customers WHERE id = ?').get(customer) as { due_balance_paise: number };
    // 30 + 100 = 130
    expect(c.due_balance_paise).toBe(13000);
  });

  it('7. collects old due ৳50 from the customer', () => {
    const cashAcc = listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')!;
    const before = (cashAcc as unknown as { balance_paise: number }).balance_paise;
    const res = collectCustomerPayment(env.db, {
      businessId: env.businessId, userId: user(), customerId: customer,
      amountPaise: 5000, method: 'cash'
    });
    expect(res.referenceNo).toMatch(/^CPY-/);
    const after = (listAccounts(env.db, env.businessId).find((a) => a.id === cashAcc.id)! as unknown as { balance_paise: number }).balance_paise;
    expect(after).toBe(before + 5000);
    const c = env.db.prepare('SELECT due_balance_paise FROM customers WHERE id = ?').get(customer) as { due_balance_paise: number };
    expect(c.due_balance_paise).toBe(8000);
  });

  it('8. pays supplier ৳2,000 from cash', () => {
    paySupplier(env.db, { businessId: env.businessId, userId: user(), supplierId, amountPaise: 200000, method: 'cash' });
    const sup = env.db.prepare('SELECT payable_balance_paise FROM suppliers WHERE id = ?').get(supplierId) as { payable_balance_paise: number };
    expect(sup.payable_balance_paise).toBe(500000);
  });

  it('9. records expenses (rent advance + electricity)', () => {
    const cats = listExpenseCategories(env.db, env.businessId);
    const rentCat = cats.find((c) => c.name === 'ভাড়া') as unknown as { id: string; name: string };
    const elecCat = cats.find((c) => c.name === 'বিদ্যুৎ বিল') as unknown as { id: string; name: string };
    createExpense(env.db, { businessId: env.businessId, userId: user(), categoryId: rentCat.id, amountPaise: 100000, method: 'cash' });
    createExpense(env.db, { businessId: env.businessId, userId: user(), categoryId: elecCat.id, amountPaise: 30000, method: 'cash' });
  });

  it('10a. processes a sales return (2 চিপস, restock + cash refund)', () => {
    const firstSale = getSale(env.db, env.businessId, 'INV-000001')!;
    const stockBefore = getStock(env.db, env.businessId, productA).quantity;
    const cashAcc = listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')!;
    const cashBefore = (cashAcc as unknown as { balance_paise: number }).balance_paise;
    const res = createSalesReturn(env.db, {
      businessId: env.businessId,
      userId: user(),
      saleId: firstSale.id,
      reason: 'ব্যাল ভাঙা',
      items: [{ saleItemId: firstSale.items[0].id, quantity: 2, restock: true }]
    });
    expect(res.totalRefundPaise).toBe(6000);
    expect(getStock(env.db, env.businessId, productA).quantity).toBe(stockBefore + 2);
    const cashAfter = (listAccounts(env.db, env.businessId).find((a) => a.id === cashAcc.id)! as unknown as { balance_paise: number }).balance_paise;
    expect(cashAfter).toBe(cashBefore - 6000);
  });

  it('10b. processes a purchase return (10 চকলেট back to supplier)', () => {
    const purchase = getPurchase(env.db, env.businessId, 'PUR-000001')!;
    const chocItem = purchase.items.find((i) => i.product_id === productB)!;
    const stockBefore = getStock(env.db, env.businessId, productB).quantity;
    const res = createPurchaseReturn(env.db, {
      businessId: env.businessId,
      userId: user(),
      purchaseId: purchase.id,
      reason: 'ক্ষতিগ্রস্ত',
      items: [{ purchaseItemId: chocItem.id, quantity: 10 }]
    });
    expect(res.totalPaise).toBe(50000);
    expect(getStock(env.db, env.businessId, productB).quantity).toBe(stockBefore - 10);
    const sup = env.db.prepare('SELECT payable_balance_paise FROM suppliers WHERE id = ?').get(supplierId) as { payable_balance_paise: number };
    // 500000 - 50000 = 450000
    expect(sup.payable_balance_paise).toBe(450000);
  });

  it('11. records MFS agent cash-in (bKash wallet float)', () => {
    const providers = listProviders(env.db, env.businessId);
    const bkash = providers.find((p) => p.key === 'bkash') as unknown as { id: string; key: string; wallet_balance_paise: number };
    const res = createMfsTransaction(env.db, {
      businessId: env.businessId,
      userId: user(),
      providerId: bkash.id,
      transactionType: 'cash_in',
      amountPaise: 1000000, // ৳10,000
      customerName: 'স্টোরকিপার',
      txnRef: 'BK-001'
    });
    expect(res.referenceNo).toMatch(/^MFS-/);
    const after = listProviders(env.db, env.businessId).find((p) => p.key === 'bkash') as unknown as { wallet_balance_paise: number };
    expect(after.wallet_balance_paise).toBe(1000000);
  });

  it('12. closes the shift — expected cash computed from real movements', () => {
    const shift = getOpenShiftOne(env.db, env.businessId, user())! as unknown as {
      id: string; opening_cash_paise: number; opened_at: number;
    };
    const opening = (shift.opening_cash_paise as number);
    const moved = shiftCashSummary(env.db, env.businessId, shift.opened_at as number, Date.now(), user());
    const expected = opening + moved.cashIn - moved.cashOut;
    // cash desk had 50,000 opening + net cash flows; "count" matches
    const res = closeShift(env.db, {
      businessId: env.businessId,
      shiftId: shift.id,
      userId: user(),
      actualCashPaise: expected
    });
    expect(res.expectedCashPaise).toBe(expected);
    expect(res.variancePaise).toBe(0);
  });

  it('13. daily closing report reconciles with report engine', () => {
    const dc = dailyClosingReport(env.db, env.businessId);
    const r = reports().salesSummary(env.businessId, today());
    // net sales = sales − returns
    expect(dc.netSales).toBe(r.net_sales - r.returns);
    expect(dc.grossProfit).toBe(dc.netSales - dc.cogs);
    expect(dc.netProfit).toBe(dc.grossProfit - dc.expenses);
  });

  it('14. ALL accounts reconcile with their ledgers', () => {
    for (const acc of listAccounts(env.db, env.businessId)) {
      const a = acc as unknown as { id: string; name: string };
      const recomputed = recomputedBalance(env.db, a.id);
      const actual = (env.db.prepare('SELECT balance_paise FROM accounts WHERE id = ?').get(a.id) as { balance_paise: number }).balance_paise;
      expect(recomputed, `account ${a.name}`).toBe(actual);
    }
  });

  it('15. inventory reconciles with movements', () => {
    const r = reconcileInventory(env.db, env.businessId);
    expect(r.ok).toBe(true);
  });

  it('16. customer/supplier ledgers reconcile', () => {
    const cust = env.db.prepare('SELECT due_balance_paise FROM customers WHERE id = ?').get(customer) as { due_balance_paise: number };
    const custLedger = env.db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN amount_paise WHEN transaction_type = 'opening' THEN amount_paise WHEN transaction_type = 'sale_return' THEN -amount_paise ELSE -amount_paise END), 0) AS bal
       FROM customer_transactions WHERE customer_id = ?`
    ).get(customer) as { bal: number };
    expect(custLedger.bal).toBe(cust.due_balance_paise);

    const sup = env.db.prepare('SELECT payable_balance_paise FROM suppliers WHERE id = ?').get(supplierId) as { payable_balance_paise: number };
    const supLedger = env.db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'purchase' THEN amount_paise WHEN transaction_type = 'opening' THEN amount_paise ELSE -amount_paise END), 0) AS bal
       FROM supplier_transactions WHERE supplier_id = ?`
    ).get(supplierId) as { bal: number };
    expect(supLedger.bal).toBe(sup.payable_balance_paise);
  });

  it('17. financial invariants hold (profit chain)', () => {
    const dc = dailyClosingReport(env.db, env.businessId);
    // net sales − COGS = gross profit; gross − expenses = net profit
    expect(dc.netSales - dc.cogs).toBe(dc.grossProfit);
    expect(dc.grossProfit - dc.expenses).toBe(dc.netProfit);
    // COGS ≤ net sales (no negative-margin data today)
    expect(dc.cogs).toBeLessThanOrEqual(dc.netSales);
    // today's cash account balance = opening + net cash movement
    const cash = listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')! as unknown as { balance_paise: number };
    const moved = shiftCashSummary(env.db, env.businessId, startOfDayLocal(Date.now()) - 86400000, endOfDayLocal(Date.now()));
    expect(cash.balance_paise).toBe(5000000 + moved.cashIn - moved.cashOut);
  });
});
