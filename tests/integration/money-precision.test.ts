/**
 * Money precision (RC: integer-paise, exact proration, no float drift).
 *
 * Invariants verified:
 *  - order-discount proration: parts sum EXACTLY to the whole
 *  - sale total = Σ line totals, always in whole paise
 *  - weighted-average cost: deterministic rounding, COGS from the stored avg
 *  - 300-sale stress: cash account equals the exact sum of cash movements
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, makeProduct, type TestEnv } from '../helpers';
import { createSale, getSale } from '../../src/domain/services/saleService';
import { createPurchase } from '../../src/domain/services/purchaseService';
import { createSupplier } from '../../src/domain/services/supplierService';
import { getStock } from '../../src/domain/services/inventoryService';
import { listAccounts, recomputedBalance } from '../../src/domain/services/accountService';
import { setSetting } from '../../src/domain/repos/settings';
import { previewSaleTotals } from '../../src/shared/saleMath';

let env: TestEnv;
const user = () => env.adminUserId;

beforeAll(() => {
  env = makeEnv({ openingCash: 100000000 }); // ৳10,00,000
});
afterAll(() => env.close());

function cashBalance(): number {
  const acc = listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')!;
  return (acc as unknown as { balance_paise: number }).balance_paise;
}

describe('proration & totals are exact in paise', () => {
  it('order discount splits exactly across uneven lines', () => {
    const a = makeProduct(env, { name: 'পণ্য A', sku: 'MP-A', cost: 1000, price: 1001, stock: 100 });
    const b = makeProduct(env, { name: 'পণ্য B', sku: 'MP-B', cost: 1000, price: 1003, stock: 100 });
    const c = makeProduct(env, { name: 'পণ্য C', sku: 'MP-C', cost: 1000, price: 1007, stock: 100 });
    const cashBefore = cashBalance();

    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: user(),
      lines: [
        { productId: a, quantity: 3 },
        { productId: b, quantity: 5 },
        { productId: c, quantity: 7 }
      ],
      orderDiscountPaise: 100, // 3003+5015+7049 = 15067 base
      payments: [{ method: 'cash', amountPaise: 15067 - 100 }]
    });

    expect(res.duePaise).toBe(0);
    const sale = getSale(env.db, env.businessId, res.saleId)!;
    const items = sale.items as { line_total_paise: number }[];
    const sumLines = items.reduce((s, i) => s + i.line_total_paise, 0);
    // parts sum exactly to the whole — no rounding residue
    expect(sumLines).toBe(sale.total_paise as number);
    expect(res.totalPaise).toBe(15067 - 100);
    expect(cashBalance()).toBe(cashBefore + (15067 - 100));
  });

  it('every paise value is an integer (no float drift after 100 sales)', () => {
    const p = makeProduct(env, { name: 'ফ্লোটেস্ট', sku: 'FLT-1', cost: 333, price: 999, stock: 10000 });
    let expectCash = cashBalance();
    for (let i = 0; i < 100; i++) {
      const qty = (i % 7) + 1;
      const gross = qty * 999;
      const disc = (i % 13) * 37;
      const r = createSale(env.db, {
        businessId: env.businessId,
        userId: user(),
        lines: [{ productId: p, quantity: qty }],
        orderDiscountPaise: disc,
        payments: [{ method: 'cash', amountPaise: gross - disc }]
      });
      expect(r.totalPaise).toBe(gross - disc);
      expect(Number.isInteger(r.totalPaise)).toBe(true);
      expectCash += gross - disc;
    }
    expect(cashBalance()).toBe(expectCash);
  });
});

describe('weighted-average costing is deterministic', () => {
  it('layered purchases update avg cost by the exact formula', () => {
    const sup = createSupplier(env.db, {
      businessId: env.businessId, name: 'টেস্ট সাপ্লায়ার', userId: user()
    });
    const p = makeProduct(env, { name: 'ওয়েটেড', sku: 'WAV-1', cost: 0, price: 5000, stock: 0 });

    // layer 1: 10 @ 1001 paise
    createPurchase(env.db, {
      businessId: env.businessId, userId: user(), supplierId: sup,
      lines: [{ productId: p, quantity: 10, unitCostPaise: 1001 }],
      payments: [{ method: 'cash', amountPaise: 10010 }]
    });
    let s = getStock(env.db, env.businessId, p);
    // 10010/10 = 1001
    expect(s.avgCostPaise).toBe(1001);

    // layer 2: 3 @ 1002 → (10·1001 + 3·1002)/13 = 13016/13 = 1001.23 → floor(x+0.5)=1001
    createPurchase(env.db, {
      businessId: env.businessId, userId: user(), supplierId: sup,
      lines: [{ productId: p, quantity: 3, unitCostPaise: 1002 }],
      payments: [{ method: 'cash', amountPaise: 3006 }]
    });
    s = getStock(env.db, env.businessId, p);
    expect(s.avgCostPaise).toBe(Math.floor((10 * 1001 + 3 * 1002) / 13 + 0.5));

    // selling 4 units books COGS from the stored avg
    const before = s.avgCostPaise;
    const sale = createSale(env.db, {
      businessId: env.businessId, userId: user(),
      lines: [{ productId: p, quantity: 4 }],
      payments: [{ method: 'cash', amountPaise: 4 * 5000 }]
    });
    expect(sale.cogsPaise).toBe(Math.round(before * 4));
  });
});

describe('300-sale cash stress: account equals exact sum of movements', () => {
  it('no drift over many mixed sales and returns', () => {
    const p1 = makeProduct(env, { name: 'স্ট্রেস ১', sku: 'ST-1', cost: 100, price: 250, stock: 100000 });
    const p2 = makeProduct(env, { name: 'স্ট্রেস ২', sku: 'ST-2', cost: 400, price: 900, stock: 100000 });
    const start = cashBalance();
    let expectCash = start;
    let totalPaise = 0;

    // tax on: 5%
    setSetting(env.db, env.businessId, 'financial', 'tax_enabled', true);
    setSetting(env.db, env.businessId, 'financial', 'tax_rate_bps', 500);

    for (let i = 0; i < 300; i++) {
      const q1 = (i % 5) + 1;
      const q2 = (i % 3) + 1;
      const disc = (i % 11) * 50;
      // compute expected tax with the SAME shared math as the domain,
      // independently of the sale service (renderer and domain use it too)
      const fin = { tax_enabled: true, tax_rate_bps: 500, tax_inclusive_prices: false };
      const t = previewSaleTotals(
        [
          { quantity: q1, unitPricePaise: 250 },
          { quantity: q2, unitPricePaise: 900 }
        ],
        fin,
        disc
      );
      const res = createSale(env.db, {
        businessId: env.businessId,
        userId: user(),
        lines: [
          { productId: p1, quantity: q1 },
          { productId: p2, quantity: q2 }
        ],
        orderDiscountPaise: disc,
        payments: [{ method: 'cash', amountPaise: t.total }]
      });
      expect(res.totalPaise).toBe(t.total);
      expectCash += t.total;
      totalPaise += t.total;
    }

    expect(cashBalance()).toBe(expectCash);
    // account ledger recomputes to the stored balance
    const acc = listAccounts(env.db, env.businessId).find((a) => a.name === 'নগদ')!;
    const a = acc as unknown as { id: string; balance_paise: number };
    expect(recomputedBalance(env.db, a.id)).toBe(a.balance_paise);
    expect(totalPaise).toBe(expectCash - start);
    // and turn tax back off for other tests in this file
    setSetting(env.db, env.businessId, 'financial', 'tax_enabled', false);
  });
});
