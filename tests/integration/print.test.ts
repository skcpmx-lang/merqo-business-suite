/**
 * Print templates (RC: barcode/printer/PDF tests — template side).
 *
 * Receipts and invoices render in the MAIN process from domain data.
 * Verified here: exact money on the document, business scoping (a token's
 * business can never pull another business's sale), and the
 * invoice.show_customer_info privacy setting.
 * (Physical printer/PDF output needs a Windows machine — NOT TESTED here.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, makeProduct, type TestEnv } from '../helpers';
import { createSale } from '../../src/domain/services/saleService';
import { createCustomer } from '../../src/domain/services/customerService';
import { setSetting } from '../../src/domain/repos/settings';
import { receiptHtml, invoiceHtml } from '../../src/main/print/receipts';
import { NotFoundError } from '../../src/domain/errors';

let env: TestEnv;
let saleRef: string;
let saleId: string;

beforeAll(() => {
  env = makeEnv({ openingCash: 100000000 });
  const customer = createCustomer(env.db, {
    businessId: env.businessId, name: 'রহিম চৌধুরী', userId: env.adminUserId
  });
  const product = makeProduct(env, { name: 'টেস্ট পণ্য', sku: 'PRT-1', price: 15000, cost: 9000, stock: 50 });
  const res = createSale(env.db, {
    businessId: env.businessId,
    userId: env.adminUserId,
    customerId: customer,
    lines: [{ productId: product, quantity: 3 }], // ৳450
    payments: [{ method: 'cash', amountPaise: 45000 }]
  });
  saleId = res.saleId;
  saleRef = res.referenceNo;
});
afterAll(() => env.close());

describe('thermal receipt template', () => {
  it('renders business, reference, customer and exact money', () => {
    const html = receiptHtml(env.db, env.businessId, saleRef, '80mm');
    expect(html).toContain('টেলে-টেস্ট শপ');
    expect(html).toContain(saleRef);
    expect(html).toContain('রহিম চৌধুরী');
    expect(html).toContain('টেস্ট পণ্য');
    // ৳450.00 in BDT format with lakh grouping
    expect(html).toContain('৳ 450.00');
    // walk-in label never appears when a customer exists
    expect(html).not.toContain('সাধারণ কাস্টমার');
  });

  it('renders 57mm width for the smaller paper', () => {
    const html = receiptHtml(env.db, env.businessId, saleRef, '57mm');
    expect(html).toContain('width: 57mm');
  });

  it('refuses a sale from another business', () => {
    expect(() => receiptHtml(env.db, 'other-business', saleRef, '80mm')).toThrow(NotFoundError);
  });
});

describe('A4 invoice template', () => {
  it('includes customer card and invoice heading', () => {
    const html = invoiceHtml(env.db, env.businessId, saleRef);
    expect(html).toContain('ইনভয়েস');
    expect(html).toContain(saleRef);
    expect(html).toContain('রহিম চৌধুরী');
    expect(html).toContain('৳ 450.00');
  });

  it('hides the customer name when show_customer_info is off', () => {
    setSetting(env.db, env.businessId, 'invoice', 'show_customer_info', false);
    try {
      const html = invoiceHtml(env.db, env.businessId, saleRef);
      expect(html).not.toContain('রহিম চৌধুরী');
    } finally {
      setSetting(env.db, env.businessId, 'invoice', 'show_customer_info', true);
    }
  });

  it('walk-in sales print the সাধারণ কাস্টমার label', () => {
    const product = makeProduct(env, { name: 'ওয়াকইন পণ্য', sku: 'PRT-2', price: 20000, cost: 10000, stock: 10 });
    const res = createSale(env.db, {
      businessId: env.businessId,
      userId: env.adminUserId,
      lines: [{ productId: product, quantity: 1 }],
      payments: [{ method: 'cash', amountPaise: 20000 }]
    });
    const html = invoiceHtml(env.db, env.businessId, res.referenceNo);
    expect(html).toContain('সাধারণ কাস্টমার');
  });
});
