import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, makeProduct, type TestEnv } from '../helpers';
import { createPurchase, getPurchase, postSupplierLedger } from '../../src/domain/services/purchaseService';
import { createSupplier, paySupplier, supplierLedger } from '../../src/domain/services/supplierService';
import { createSalesReturn } from '../../src/domain/services/returnService';
import { createPurchaseReturn } from '../../src/domain/services/returnService';
import { getStock, reconcileInventory } from '../../src/domain/services/inventoryService';
import { listAccounts } from '../../src/domain/services/accountService';
import { ValidationError } from '../../src/domain/errors';
import { getSale, createSale } from '../../src/domain/services/saleService';

let env: TestEnv;
const user = () => env.adminUserId;

beforeAll(() => {
  env = makeEnv({ openingCash: 20000000 }); // ৳2,00,000
});
afterAll(() => env.close());

describe('purchase → stock → supplier payable → payment (integration)', () => {
  it('records a partial-payment purchase: stock in at cost, supplier due updated', () => {
    const supplier = createSupplier(env.db, {
      businessId: env.businessId,
      name: 'ঢাকা ডিস্ট্রিবিউশন',
      phone: '02-5550000',
      openingPayablePaise: 0,
      userId: user()
    });
    const product = makeProduct(env, { name: 'সম্পূর্ণ চিনি', sku: 'SUG-1', cost: 0, price: 12000, stock: 0 });

    const res = createPurchase(env.db, {
      businessId: env.businessId,
      userId: user(),
      supplierId: supplier,
      supplierInvoiceNo: 'DD-451',
      lines: [{ productId: product, quantity: 50, unitCostPaise: 10000 }],
      payments: [{ method: 'cash', amountPaise: 200000 }]
    });

    expect(res.referenceNo).toBe('PUR-000001');
    expect(res.totalPaise).toBe(500000);
    expect(res.paidPaise).toBe(200000);
    expect(res.duePaise).toBe(300000);

    expect(getStock(env.db, env.businessId, product).quantity).toBe(50);
    expect(getStock(env.db, env.businessId, product).avgCostPaise).toBe(10000);

    const sup = env.db.prepare('SELECT payable_balance_paise FROM suppliers WHERE id = ?').get(supplier) as { payable_balance_paise: number };
    expect(sup.payable_balance_paise).toBe(300000);
  });

  it('paying supplier reduces payable and cash', () => {
    const supplier = env.db.prepare('SELECT id FROM suppliers ORDER BY created_at ASC LIMIT 1').get() as { id: string };
    const cashAcc = listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')!;
    const cashBefore = (cashAcc as unknown as { balance_paise: number }).balance_paise;

    const res = paySupplier(env.db, {
      businessId: env.businessId,
      userId: user(),
      supplierId: supplier.id,
      amountPaise: 100000,
      method: 'cash'
    });
    expect(res.referenceNo).toMatch(/^SPY-\d{6}$/);
    const sup = env.db.prepare('SELECT payable_balance_paise FROM suppliers WHERE id = ?').get(supplier.id) as { payable_balance_paise: number };
    expect(sup.payable_balance_paise).toBe(200000);
    const cashAfter = (listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')! as unknown as { balance_paise: number }).balance_paise;
    expect(cashAfter).toBe(cashBefore - 100000);
  });

  it('blocks payment above payable', () => {
    const supplier = env.db.prepare('SELECT id FROM suppliers ORDER BY created_at ASC LIMIT 1').get() as { id: string };
    expect(() =>
      paySupplier(env.db, {
        businessId: env.businessId,
        userId: user(),
        supplierId: supplier.id,
        amountPaise: 50000000,
        method: 'cash'
      })
    ).toThrow(ValidationError);
  });

  it('purchase return: stock out, payable reduced, stock value updated', () => {
    const supplier = env.db.prepare('SELECT id FROM suppliers ORDER BY created_at ASC LIMIT 1').get() as { id: string };
    const purchase = getPurchase(env.db, env.businessId, 'PUR-000001')!;
    const item = purchase.items[0];

    const res = createPurchaseReturn(env.db, {
      businessId: env.businessId,
      userId: user(),
      purchaseId: purchase.id,
      reason: 'ক্ষতিগ্রস্ত',
      items: [{ purchaseItemId: item.id, quantity: 10 }]
    });
    expect(res.totalPaise).toBe(100000);
    expect(getStock(env.db, env.businessId, item.product_id).quantity).toBe(40);
    const sup = env.db.prepare('SELECT payable_balance_paise FROM suppliers WHERE id = ?').get(supplier.id) as { payable_balance_paise: number };
    expect(sup.payable_balance_paise).toBe(100000);
  });

  it('supplier ledger shows the full chronology', () => {
    const supplier = env.db.prepare('SELECT id FROM suppliers ORDER BY created_at ASC LIMIT 1').get() as { id: string };
    const ledger = supplierLedger(env.db, env.businessId, supplier.id);
    const types = ledger.map((l) => l.transaction_type);
    expect(types).toContain('purchase');
    expect(types).toContain('payment');
    expect(types).toContain('purchase_return');
  });
});

describe('sales return → stock restoration → financial reversal (integration)', () => {
  it('returns part of a sale: stock back, refund from cash, sale marked partially_refunded', () => {
    // set up a sale first
    const product = makeProduct(env, { name: 'ফল', sku: 'FRU-1', cost: 3000, price: 5000, stock: 100 });
    const sale = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      lines: [{ productId: product, quantity: 6 }],
      payments: [{ method: 'cash', amountPaise: 30000 }]
    });
    const stockAfterSale = getStock(env.db, env.businessId, product).quantity;
    const cashAcc = listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')!;
    const cashBeforeReturn = (cashAcc as unknown as { balance_paise: number }).balance_paise;

    const saleDetail = getSale(env.db, env.businessId, sale.saleId)!;
    const item = saleDetail.items[0];

    const res = createSalesReturn(env.db, {
      businessId: env.businessId,
      userId: user(),
      saleId: sale.saleId,
      reason: 'গুণগত মান সমস্যা',
      items: [{ saleItemId: item.id, quantity: 2, restock: true }]
    });
    expect(res.totalRefundPaise).toBe(10000); // 2 × ৳500
    expect(getStock(env.db, env.businessId, product).quantity).toBe(stockAfterSale + 2);
    const cashAfterReturn = (listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')! as unknown as { balance_paise: number }).balance_paise;
    expect(cashAfterReturn).toBe(cashBeforeReturn - 10000);
    const status = getSale(env.db, env.businessId, sale.saleId)!.status;
    expect(status).toBe('partially_refunded');
  });

  it('blocks returning more than sold', () => {
    const product = makeProduct(env, { name: 'মাংস', sku: 'MNS-1', cost: 50000, price: 70000, stock: 50 });
    const sale = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      lines: [{ productId: product, quantity: 2 }],
      payments: [{ method: 'cash', amountPaise: 140000 }]
    });
    const saleDetail = getSale(env.db, env.businessId, sale.saleId)!;
    expect(() =>
      createSalesReturn(env.db, {
        businessId: env.businessId,
        userId: user(),
        saleId: sale.saleId,
        items: [{ saleItemId: saleDetail.items[0].id, quantity: 3, restock: true }]
      })
    ).toThrow(ValidationError);
  });
});

describe('inventory valuation (weighted average, §28)', () => {
  it('weighted average cost updates on each purchase layer', () => {
    const product = makeProduct(env, { name: 'সব্জি', sku: 'VGT-1', cost: 0, price: 9999, stock: 0 });
    const supplier = env.db.prepare('SELECT id FROM suppliers ORDER BY created_at ASC LIMIT 1').get() as { id: string };

    // layer 1: 10 @ ৳100
    createPurchase(env.db, {
      businessId: env.businessId, userId: user(), supplierId: supplier.id,
      lines: [{ productId: product, quantity: 10, unitCostPaise: 10000 }], payments: []
    });
    expect(getStock(env.db, env.businessId, product).avgCostPaise).toBe(10000);

    // layer 2: 10 @ ৳200 → avg (10×100 + 10×200)/20 = ৳150
    createPurchase(env.db, {
      businessId: env.businessId, userId: user(), supplierId: supplier.id,
      lines: [{ productId: product, quantity: 10, unitCostPaise: 20000 }], payments: []
    });
    expect(getStock(env.db, env.businessId, product).avgCostPaise).toBe(15000);

    // sell 20 → COGS ৳3,000; stock empty, avg remains ৳150
    const sale = createSale(env.db, {
      businessId: env.businessId, userId: user(),
      lines: [{ productId: product, quantity: 20, unitPricePaise: 16000 }],
      payments: [{ method: 'cash', amountPaise: 320000 }]
    });
    const detail = getSale(env.db, env.businessId, sale.saleId)!;
    expect(detail.cogs_paise).toBe(300000);
    expect(detail.total_paise - detail.cogs_paise).toBe(20000); // gross profit ৳200

    // layer 3 after empty: 5 @ ৳300 → avg resets to ৳300
    createPurchase(env.db, {
      businessId: env.businessId, userId: user(), supplierId: supplier.id,
      lines: [{ productId: product, quantity: 5, unitCostPaise: 30000 }], payments: []
    });
    expect(getStock(env.db, env.businessId, product).avgCostPaise).toBe(30000);
  });

  it('final inventory reconciliation is clean', () => {
    const r = reconcileInventory(env.db, env.businessId);
    expect(r.ok).toBe(true);
    expect(r.mismatches).toEqual([]);
  });
});
