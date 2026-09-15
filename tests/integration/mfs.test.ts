import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeEnv, type TestEnv } from '../helpers';
import {
  createMfsTransaction, listProviders, saveCommissionRule, computeCommission,
  mfsReconciliation, mfsSummary, setupWallet, queryMfsTransactions
} from '../../src/domain/services/mfsService';
import { listAccounts } from '../../src/domain/services/accountService';
import { ValidationError } from '../../src/domain/errors';

let env: TestEnv;
const user = () => env.adminUserId;

beforeAll(() => {
  env = makeEnv({ openingCash: 10000000 });
});
afterAll(() => env.close());

function bkashId(): string {
  return listProviders(env.db, env.businessId).find((p) => p.key === 'bkash')!.id as string;
}

describe('MFS agent module (§40–§43)', () => {
  it('starts with 4 system providers and zero wallets (no fake data)', () => {
    const providers = listProviders(env.db, env.businessId);
    expect(providers).toHaveLength(4);
    for (const p of providers) {
      expect(p.wallet_balance_paise).toBe(0);
    }
  });

  it('cash-in: wallet +, shop cash +', () => {
    const cashBefore = (listAccounts(env.db, env.businessId).find((a) => a.kind === 'cash')! as { balance_paise: number }).balance_paise;
    const res = createMfsTransaction(env.db, {
      businessId: env.businessId, userId: user(), providerId: bkashId(),
      transactionType: 'cash_in', amountPaise: 500000, customerName: 'আব্দুল', txnRef: 'BK-100'
    });
    expect(res.referenceNo).toMatch(/^MFS-\d{6}$/);
    expect(res.commissionPaise).toBe(0); // no rule yet
    const after = listProviders(env.db, env.businessId).find((p) => p.key === 'bkash')!;
    expect(after.wallet_balance_paise).toBe(500000);
    const cashAfter = (listAccounts(env.db, env.businessId).find((a) => a.kind === 'cash')! as { balance_paise: number }).balance_paise;
    expect(cashAfter).toBe(cashBefore + 500000);
  });

  it('cash-out: wallet −, shop cash −; blocked beyond wallet balance', () => {
    createMfsTransaction(env.db, {
      businessId: env.businessId, userId: user(), providerId: bkashId(),
      transactionType: 'cash_out', amountPaise: 200000, customerName: 'রহিম'
    });
    const after = listProviders(env.db, env.businessId).find((p) => p.key === 'bkash')!;
    expect(after.wallet_balance_paise).toBe(300000);
    expect(() =>
      createMfsTransaction(env.db, {
        businessId: env.businessId, userId: user(), providerId: bkashId(),
        transactionType: 'cash_out', amountPaise: 400000
      })
    ).toThrow(ValidationError);
  });

  it('send_money: wallet +, shop cash + (customer cash settles into float)', () => {
    const cashBefore = (listAccounts(env.db, env.businessId).find((a) => a.kind === 'cash')! as { balance_paise: number }).balance_paise;
    createMfsTransaction(env.db, {
      businessId: env.businessId, userId: user(), providerId: bkashId(),
      transactionType: 'send_money', amountPaise: 100000, customerName: 'করিম', customerPhone: '01711112222'
    });
    const after = listProviders(env.db, env.businessId).find((p) => p.key === 'bkash')!;
    expect(after.wallet_balance_paise).toBe(400000);
    const cashAfter = (listAccounts(env.db, env.businessId).find((a) => a.kind === 'cash')! as { balance_paise: number }).balance_paise;
    expect(cashAfter).toBe(cashBefore + 100000);
  });

  it('commission rules compute commission; min/max clamp applies', () => {
    saveCommissionRule(env.db, {
      businessId: env.businessId, userId: user(), providerId: bkashId(),
      transactionType: 'cash_in', rateBps: 500 // 5%
    });
    expect(computeCommission(env.db, env.businessId, bkashId(), 'cash_in', 100000)).toBe(5000); // ৳50
    expect(computeCommission(env.db, env.businessId, bkashId(), 'cash_out', 100000)).toBe(0); // no rule
    saveCommissionRule(env.db, {
      businessId: env.businessId, userId: user(), providerId: bkashId(),
      transactionType: 'cash_out', fixedAmountPaise: 2500, minPaise: 2500, maxPaise: 3000
    });
    expect(computeCommission(env.db, env.businessId, bkashId(), 'cash_out', 100000)).toBe(2500);
    // transaction picks up the commission
    const res = createMfsTransaction(env.db, {
      businessId: env.businessId, userId: user(), providerId: bkashId(),
      transactionType: 'cash_out', amountPaise: 100000
    });
    expect(res.commissionPaise).toBe(2500);
  });

  it('reconciliation: expected = opening + in − out; variance 0', () => {
    const rec = mfsReconciliation(env.db, env.businessId, bkashId());
    // cash_in 500k + send_money 100k (cash into float) − cash_out 200k − cash_out 100k (commission test)
    expect(rec.cashInPaise).toBe(600000);
    expect(rec.cashOutPaise).toBe(300000);
    expect(rec.transactionCount).toBeGreaterThanOrEqual(4);
    expect(rec.expectedBalancePaise).toBe(300000);
    expect(rec.walletBalancePaise).toBe(300000);
    expect(rec.variancePaise).toBe(0);
  });

  it('summary groups per provider', () => {
    const summary = mfsSummary(env.db, env.businessId);
    const bkash = summary.find((s) => s.provider_name === 'bKash')!;
    expect(bkash.cash_in).toBe(600000);
    expect(bkash.cash_out).toBe(300000);
    expect(bkash.commission).toBe(2500);
  });

  it('transaction list filters by provider', () => {
    const all = queryMfsTransactions(env.db, { businessId: env.businessId });
    expect(all.rows.length).toBeGreaterThanOrEqual(4);
    const onlyBkash = queryMfsTransactions(env.db, { businessId: env.businessId, providerId: bkashId() });
    expect(onlyBkash.rows.length).toBe(all.rows.length);
  });

  it('wallet setup updates account number', () => {
    setupWallet(env.db, { businessId: env.businessId, userId: user(), providerId: bkashId(), accountNo: '017XXXX' });
    const after = listProviders(env.db, env.businessId).find((p) => p.key === 'bkash')!;
    expect(after.wallet_account_no).toBe('017XXXX');
  });
});
