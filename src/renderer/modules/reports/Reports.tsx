/** Reports — every figure comes from the same Reports engine the
 *  dashboard uses, so the two never disagree (§125). */
import React, { useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, Money, useToast, Empty, Bn, fmtDate } from '../../ui';
import { RANGE_PRESETS, resolveRange } from '@shared/dates';
import { paymentMethodLabel } from '@shared/payments';

type ReportTab = 'sales' | 'pnl' | 'stock' | 'accounts' | 'expenses' | 'collections';

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'sales', label: 'বিক্রয়' },
  { key: 'pnl', label: 'লাভ-ক্ষতি' },
  { key: 'stock', label: 'ইনভেন্টরি' },
  { key: 'accounts', label: 'হিসাব' },
  { key: 'expenses', label: 'খরচ' },
  { key: 'collections', label: 'আদায়/দেয়াদায়ী' }
];

export function Reports() {
  const { user, can } = useSession();
  const token = user!.token;
  const [tab, setTab] = useState<ReportTab>('sales');
  const [preset, setPreset] = useState('thisMonth');
  const range = resolveRange(preset as never);
  const toast = useToast();

  async function exportCsv(entity: 'sales' | 'purchases') {
    try {
      const csv = await api.exports.csv(token, entity);
      const path = await api.app.saveFile(`${entity}_${Date.now()}.csv`, '\uFEFF' + csv);
      if (path) toast('success', 'CSV সংরক্ষিত', path);
    } catch (e) {
      toast('error', 'এক্সপোর্ট হয়নি', errMsg(e));
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">রিপোর্ট</div>
          <div className="page-sub">{RANGE_PRESETS.find((p) => p.key === preset)?.label} — ড্যাশবোর্ডের সাথে সবসময় মিলে থাকে</div>
        </div>
        <div className="toolbar">
          {can('exports.run') && (<>
            <Button icon={<Download size={15} />} onClick={() => void exportCsv('sales')}>বিক্রয় CSV</Button>
            <span style={{ width: 8 }} />
            <Button icon={<Download size={15} />} onClick={() => void exportCsv('purchases')}>ক্রয় CSV</Button>
          </>)}
          <select className="select" style={{ width: 150 }} value={preset} onChange={(e) => setPreset(e.target.value)}>
            {RANGE_PRESETS.filter((p) => p.key !== 'custom').map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {TABS.filter((t) => (t.key === 'pnl' ? can('profit.view') : t.key === 'accounts' ? can('accounts.view') : true)).map((t) => (
          <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'sales' && <SalesReport token={token} range={range} />}
      {tab === 'pnl' && can('profit.view') && <PnlReport token={token} range={range} />}
      {tab === 'stock' && <StockReport token={token} range={range} />}
      {tab === 'accounts' && can('accounts.view') && <AccountsReport token={token} />}
      {tab === 'expenses' && <ExpensesReport token={token} range={range} />}
      {tab === 'collections' && <CollectionsReport token={token} range={range} />}
    </div>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'green' | 'red' | 'amber' }) {
  const color = tone === 'green' ? 'var(--c-success)' : tone === 'red' ? 'var(--c-danger)' : tone === 'amber' ? 'var(--c-warn)' : 'var(--c-ink)';
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 'var(--fs-xl)', color }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ReportTable({ head, rows, renderRow }: { head: string[]; rows: Row[]; renderRow: (r: Row) => React.ReactNode[] }) {
  return (
    <div className="table-wrap" style={{ borderRadius: 12 }}>
      <table className="tbl">
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length}><Empty title="এই সময়ে ডেটা নেই" compact /></td></tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>{renderRow(r).map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SalesReport({ token, range }: { token: string; range: { from: number; to: number } }) {
  const { user } = useSession();
  const showProfit = user!.isOwner || user!.permissions.includes('profit.view');
  const { data: summary } = useAsync(async () => (await api.reports.salesSummary(token, range)) as Row, [token, range.from, range.to]);
  const { data: byDay } = useAsync(async () => (await api.reports.salesByDay(token, range, 'day')) as Row[], [token, range.from, range.to]);
  const { data: byMethod } = useAsync(async () => (await api.reports.salesByPaymentMethod(token, range)) as Row[], [token, range.from, range.to]);
  const { data: byProduct } = useAsync(async () => (await api.reports.salesByProduct(token, range)) as Row[], [token, range.from, range.to]);

  const maxDay = Math.max(1, ...(byDay ?? []).map((d) => (d.total as number) ?? 0));

  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 16 }}>
        <MiniStat label="নিট বিক্রয়" value={<Money paise={(summary?.net_sales as number) ?? 0} />} sub={`${summary?.sale_count ?? 0}টি বিল`} />
        <MiniStat label="ছাড়" value={<Money paise={(summary?.discounts as number) ?? 0} />} />
        <MiniStat label="ফেরত" value={<Money paise={(summary?.returns as number) ?? 0} />} />
        <MiniStat label="প্রাপ্ত" value={<Money paise={(summary?.received as number) ?? 0} />} />
        {showProfit && <MiniStat label="খচরা লাভ" value={<Money paise={((((summary?.net_sales as number) ?? 0) - ((summary?.returns as number) ?? 0) - ((summary?.cogs as number) ?? 0)))} />} sub="নিট বিক্রয় − COGS" />}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>দিন অনুযায়ী বিক্রয়</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 170 }}>
            {(byDay ?? []).map((d, i) => (
              <div key={i} title={`${fmtDate((d.label as number) ?? null)}: ৳${(((d.total as number) ?? 0) / 100).toLocaleString('en-IN')}`} style={{ flex: 1, minHeight: 3, height: `${Math.max(2, (((d.total as number) ?? 0) / maxDay) * 100)}%`, background: 'var(--c-primary)', borderRadius: '3px 3px 1px 1px', opacity: 0.55 + 0.45 * (((d.total as number) ?? 0) / maxDay) }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)', marginTop: 6 }}>
            <span>{fmtDate(((byDay ?? [])[0]?.label as number) ?? null)}</span>
            <span>{fmtDate(((byDay ?? [])[ (byDay ?? []).length - 1 ]?.label as number) ?? null)}</span>
          </div>
        </div>
        <div>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>পেমেন্ট মাধ্যম অনুযায়ী</div>
          <ReportTable
            head={['মাধ্যম', 'মোট']}
            rows={byMethod ?? []}
            renderRow={(r) => [paymentMethodLabel(String(r.method)), <Money paise={(r.total as number) ?? 0} />]}
          />
        </div>
      </div>
      <div style={{ height: 16 }} />
      <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>পণ্য অনুযায়ী</div>
      <ReportTable
        head={showProfit ? ['পণ্য', 'পরিমাণ', 'বিক্রয়', 'খচরা লাভ'] : ['পণ্য', 'পরিমাণ', 'বিক্রয়']}
        rows={(byProduct ?? []).slice(0, 20)}
        renderRow={(r) => [String(r.name ?? ''), <Bn>{String(r.qty ?? '')}</Bn>, <Money paise={(r.revenue as number) ?? 0} />, ...(showProfit ? [<Money paise={(r.profit as number) ?? 0} />] : [])]}
      />
    </div>
  );
}

function PnlReport({ token, range }: { token: string; range: { from: number; to: number } }) {
  const { data } = useAsync(async () => (await api.reports.profitAndLoss(token, range)) as Row, [token, range.from, range.to]);
  if (!data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }
  const rows: [string, number, string?][] = [
    ['নিট বিক্রয়', (data.netSales as number) ?? 0],
    ['(−) COGS (বিক্রয়ের খরচ)', -(((data.cogs as number) ?? 0)), 'deduct'],
    ['= খচরা লাভ', (data.grossProfit as number) ?? 0, 'subtotal'],
    ['(−) মোট খরচ', -(((data.expenses as number) ?? 0)), 'deduct'],
    ['= নিট লাভ', (data.netProfit as number) ?? 0, 'total']
  ];
  return (
    <div className="card card-pad" style={{ maxWidth: 560 }}>
      <div className="card-title"><BarChart3 size={16} /> লাভ-ক্ষতির হিসাব</div>
      {rows.map(([label, val, cls], i) => (
        <div key={i} className="line" style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: cls === 'total' ? 'none' : '1px solid var(--c-border)', fontSize: cls === 'total' ? 'var(--fs-lg)' : 'var(--fs-md)', fontWeight: cls === 'subtotal' || cls === 'total' ? 800 : 500, color: cls === 'deduct' ? 'var(--c-ink-2)' : 'var(--c-ink)' }}>
          <span>{label}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}><Money paise={val} /></span>
        </div>
      ))}
    </div>
  );
}

function StockReport({ token, range }: { token: string; range: { from: number; to: number } }) {
  const { can } = useSession();
  const showCost = can('stock.viewCost');
  const allowStock = can('stock.view');
  const { data: summary } = useAsync(allowStock ? async () => (await api.reports.stockSummary(token)) as Row : (async () => ({} as Row)), [token, allowStock]);
  const { data: topValue } = useAsync(showCost ? async () => (await api.reports.topStockValue(token)) as Row[] : (async () => []), [token, showCost]);
  const { data: dead } = useAsync(async () => (await api.reports.deadStock(token)) as Row[], [token]);
  const { data: fast } = useAsync(async () => (await api.reports.fastMoving(token, range)) as Row[], [token, range.from, range.to]);
  const { data: slow } = useAsync(async () => (await api.reports.slowMoving(token, range)) as Row[], [token, range.from, range.to]);

  return (
    <div>
      {allowStock && (
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <MiniStat label="মোট পণ্য" value={<Bn>{String(summary?.products ?? 0)}</Bn>} />
        <MiniStat label="কম স্টক" value={<Bn>{String(summary?.low_stock ?? 0)}</Bn>} />
        <MiniStat label="শেষ স্টক" value={<Bn>{String(summary?.out_of_stock ?? 0)}</Bn>} />
        {showCost && <MiniStat label="মোট স্টক মূল্য" value={<Money paise={(summary?.stock_value as number) ?? 0} />} sub="খরচদামে" />}
      </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>সর্বাধিক মূল্যের স্টক</div>
          <ReportTable head={['পণ্য', 'মূল্য']} rows={(topValue ?? []).slice(0, 15)} renderRow={(r) => [String(r.name ?? ''), <Money paise={(r.value as number) ?? 0} />]} />
        </div>
        <div>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>মৃত স্টক (৯০ দিনে বিক্রয় নেই)</div>
          <ReportTable head={['পণ্য', 'স্টক']} rows={(dead ?? []).slice(0, 15)} renderRow={(r) => [String(r.name ?? ''), <Bn>{String(r.quantity ?? '')}</Bn>]} />
        </div>
        <div>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>দ্রুত বিক্রিত</div>
          <ReportTable head={['পণ্য', 'পরিমাণ']} rows={(fast ?? []).slice(0, 10)} renderRow={(r) => [String(r.name ?? ''), <Bn>{String(r.qty ?? '')}</Bn>]} />
        </div>
        <div>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>মন্দ বিক্রি</div>
          <ReportTable head={['প্ণ্য', 'স্ডক', 'বিক্রি']} rows={(slow ?? []).slice(0, 10)} renderRow={(r) => [String(r.name ?? ''), <Bn>{String(r.quantity ?? 0)}</Bn>, <Bn>{String(r.sold_recent ?? 0)}</Bn>]} />
        </div>
      </div>
    </div>
  );
}

function AccountsReport({ token }: { token: string }) {
  const { data: balances } = useAsync(async () => (await api.reports.accountBalanceSheet(token)) as Row[], [token]);
  const { data: rp } = useAsync(async () => (await api.reports.receivablePayable(token)) as Row, [token]);
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div>
        <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>হিসাবের ব্যালেন্স</div>
        <ReportTable
          head={['হিসাব', 'ধরন', 'ব্যালেন্স']}
          rows={balances ?? []}
          renderRow={(r) => [String(r.name ?? ''), String(r.kind ?? ''), <Money paise={(r.balance_paise as number) ?? 0} />]}
        />
      </div>
      <div>
        <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>প্রাপ্য ও দেনা</div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <MiniStat label="কাস্টমারের বকেয়া (প্রাপ্য)" value={<Money paise={(rp?.receivable as number) ?? 0} />} tone="green" />
          <MiniStat label="সাপ্লায়ারের বকেয়া (দেনা)" value={<Money paise={(rp?.payable as number) ?? 0} />} tone="red" />
        </div>
      </div>
    </div>
  );
}

function ExpensesReport({ token, range }: { token: string; range: { from: number; to: number } }) {
  const { data } = useAsync(async () => (await api.reports.expensesByCategory(token, range)) as Row[], [token, range.from, range.to]);
  const total = (data ?? []).reduce((s, r) => s + ((r.total as number) ?? 0), 0);
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>ক্যাটাগরি অনুযায়ী</div>
          <ReportTable head={['ক্যাটাগরি', 'পরিমাণ', 'মোট']} rows={data ?? []} renderRow={(r) => [String(r.category ?? ''), <Bn>{String(r.count ?? '')}</Bn>, <Money paise={(r.total as number) ?? 0} />]} />
        </div>
        <div className="card card-pad">
          <div className="stat-label">মোট খরচ (সময়ে)</div>
          <div className="stat-value" style={{ color: 'var(--c-warn)' }}><Money paise={total} /></div>
          <div className="stat-sub">{(data ?? []).length}টি ক্যাটাগরি</div>
        </div>
      </div>
    </div>
  );
}

function CollectionsReport({ token, range }: { token: string; range: { from: number; to: number } }) {
  const { can } = useSession();
  const allowCust = can('customers.view');
  const allowSup = can('suppliers.view');
  const { data: byDay } = useAsync(allowCust ? async () => (await api.reports.collectionsByDay(token, range)) as Row[] : (async () => []), [token, range.from, range.to, allowCust]);
  const { data: dues } = useAsync(allowCust ? async () => (await api.reports.topCustomerDues(token)) as Row[] : (async () => []), [token, allowCust]);
  const { data: payables } = useAsync(allowSup ? async () => (await api.reports.topSupplierPayables(token)) as Row[] : (async () => []), [token, allowSup]);
  const total = (byDay ?? []).reduce((s, r) => s + ((r.total as number) ?? 0), 0);
  const maxDay = Math.max(1, ...(byDay ?? []).map((d) => (d.total as number) ?? 0));
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>দিন অনুযায়ী আদায় (মোট ৳{((total / 100).toLocaleString('en-IN'))})</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 150 }}>
            {(byDay ?? []).map((d, i) => (
              <div key={i} title={`${fmtDate((d.label as number) ?? null)}: ৳${(((d.total as number) ?? 0) / 100).toLocaleString('en-IN')}`} style={{ flex: 1, minHeight: 3, height: `${Math.max(2, (((d.total as number) ?? 0) / maxDay) * 100)}%`, background: 'var(--c-success)', borderRadius: '3px 3px 1px 1px', opacity: 0.6 + 0.4 * (((d.total as number) ?? 0) / maxDay) }} />
            ))}
          </div>
        </div>
        <div>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>সর্বাধিক বকেয়া (কাস্টমার)</div>
          <ReportTable head={['কাস্টমার', 'ফোন', 'বকেয়া']} rows={dues ?? []} renderRow={(r) => [String(r.name ?? ''), String(r.phone ?? ''), <Money paise={(r.due_balance_paise as number) ?? 0} />]} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="card-title" style={{ fontSize: 'var(--fs-md)', marginBottom: 10 }}>সর্বাধিক দেয়াদায়ী (সাপ্লায়ার)</div>
          <ReportTable head={['সাপ্লায়ার', 'ফোন', 'দেয়াদায়ী']} rows={payables ?? []} renderRow={(r) => [String(r.name ?? ''), String(r.phone ?? ''), <Money paise={(r.payable_balance_paise as number) ?? 0} />]} />
        </div>
      </div>
    </div>
  );
}
