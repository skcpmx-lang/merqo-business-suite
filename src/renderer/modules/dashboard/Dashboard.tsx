/** Dashboard — KPIs + trends, all from the same domain engine as reports
 *  (dashboardService → Reports), so numbers always reconcile (§125). */
import React, { useState } from 'react';
import {
  Banknote, PiggyBank, TrendingUp, Wallet, ArrowDownToLine,
  PackageX, Users, AlertCircle, Boxes, Landmark, Smartphone
} from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Money, StatCard, Empty, fmtDate } from '../../ui';
import { RANGE_PRESETS } from '@shared/dates';
import { paymentMethodLabel } from '@shared/payments';
import { SelectInput, Button } from '../../ui';

function BarChart({
  data,
  height = 150,
  color = 'var(--c-primary)',
  format
}: {
  data: { label: number; total: number }[];
  height?: number;
  color?: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
      {data.map((d, i) => (
        <div
          key={i}
          title={`${fmtDate(d.label)}: ${format ? format(d.total) : d.total.toLocaleString('en-IN')}`}
          style={{
            flex: 1,
            minHeight: 3,
            height: `${Math.max(2, (d.total / max) * 100)}%`,
            background: color,
            borderRadius: '4px 4px 2px 2px',
            opacity: 0.55 + 0.45 * (d.total / max),
            transition: 'height 200ms ease'
          }}
        />
      ))}
    </div>
  );
}

function ChartCard({ title, children, axis }: { title: string; children: React.ReactNode; axis?: string[] }) {
  return (
    <div className="card card-pad">
      <div className="card-title" style={{ fontSize: 'var(--fs-md)' }}>{title}</div>
      {children}
      {axis && axis.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>
          <span>{fmtDate(axis[0] ? Number(axis[0]) : null)}</span>
          <span>{fmtDate(axis[axis.length - 1] ? Number(axis[axis.length - 1]) : null)}</span>
        </div>
      )}
    </div>
  );
}

const fmtTaka = (v: number) => `৳${(v / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function Dashboard() {
  const { user, can } = useSession();
  const [preset, setPreset] = useState('last7');
  const token = user!.token;

  const { data, busy, error, reload } = useAsync(async () => {
    const d = await api.dashboard.get(token, preset);
    return d as unknown as Row & {
      kpis: Record<string, number>;
      kpiDeltas: { sales: number; profit: number };
      salesTrend: { label: number; total: number }[];
      profitTrend: { label: number; gross: number; net: number }[];
      purchaseTrend: { label: number; total: number }[];
      expenseTrend: { label: number; total: number }[];
      paymentMix: { method: string; total: number }[];
      topProducts: { name: string; qty: number; revenue: number; profit: number }[];
      lowStock: { name: string; quantity: number; reorder_level: number }[];
      outOfStock: { name: string }[];
      topCustomerDues: { name: string; phone: string; due_balance_paise: number }[];
      topSupplierPayables: { name: string; phone: string; payable_balance_paise: number }[];
    };
  }, [preset, token]);

  if (error) {
    return <Empty title="ড্যাশবোর্ড দেখানো যায়নি" sub={error} icon={<AlertCircle size={22} />} />;
  }
  if (busy || !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <div className="spinner" />
      </div>
    );
  }

  const k = data.kpis;
  const showProfit = can('profit.view');
  const presetMeta = RANGE_PRESETS.find((p) => p.key === preset);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">সারসংক্ষেপ</div>
          <div className="page-sub">আজ, {fmtDate(Date.now())} — {presetMeta?.label}</div>
        </div>
        <div className="toolbar">
          <SelectInput value={preset} onChange={(e) => setPreset(e.target.value)} style={{ width: 150 }}>
            {RANGE_PRESETS.filter((p) => p.key !== 'custom').map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </SelectInput>
          <Button icon={<TrendingUp size={15} />} onClick={reload} loading={busy}>
            রিফ্রেশ
          </Button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard
          label="আজকের বিক্রয়"
          icon={<Banknote size={15} style={{ color: 'var(--c-primary)' }} />}
          value={<Money paise={k.todaySales} />}
          sub={`${data.kpiDeltas.sales >= 0 ? '+' : ''}${fmtTaka(data.kpiDeltas.sales)} পূর্ববর্তী সময়ে তুলনায়`}
        />
        <StatCard
          label="আজকের খরচ"
          icon={<ArrowDownToLine size={15} style={{ color: 'var(--c-warn)' }} />}
          value={<Money paise={k.todayExpenses} />}
          sub="বিল + অন্যান্য"
        />
        <StatCard
          label={showProfit ? 'আজকের লাভ' : 'আজকের ক্রয়'}
          tone={showProfit ? 'green' : undefined}
          icon={<PiggyBank size={15} style={{ color: 'var(--c-success)' }} />}
          value={showProfit ? <Money paise={k.todayProfit} /> : <Money paise={k.todayPurchases} />}
          sub={showProfit ? 'নিট বিক্রয় − COGS' : 'ক্রয়'}
        />
        <StatCard
          label="কাস্টমারের বকেয়া"
          icon={<Users size={15} style={{ color: 'var(--c-danger)' }} />}
          value={<Money paise={k.customerDue} />}
          sub="সকল কাস্টমার মিলিয়ে"
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 16 }}>
        <StatCard
          label="নগদ"
          icon={<Wallet size={15} />}
          value={<Money paise={k.cashBalance} />}
          sub="ক্যাশ হিসাব"
        />
        <StatCard
          label="ব্যাংক"
          icon={<Landmark size={15} />}
          value={<Money paise={k.bankBalance} />}
          sub="ব্যাংক হিসাব"
        />
        <StatCard
          label="MFS (bKash/Nagad/…)"
          icon={<Smartphone size={15} />}
          value={<Money paise={k.mfsBalance} />}
          sub="MFS হিসাবগুলো মিলিয়ে"
        />
        <StatCard
          label="স্টকের মূল্য"
          icon={<Boxes size={15} />}
          value={<Money paise={k.stockValue} />}
          sub="খরচদামে"
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', marginTop: 16 }}>
        <div>
          <ChartCard title="বিক্রয়ের প্রবণতা (বাছাই করা সময়ে)" axis={data.salesTrend.map((d) => String(d.label))}>
            <BarChart data={data.salesTrend} format={fmtTaka} />
          </ChartCard>
          {showProfit && (
            <div style={{ height: 16 }} />
          )}
          {showProfit && (
            <ChartCard title="লাভ (মূল ও নিট)" axis={data.profitTrend.map((d) => String(d.label))}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150 }}>
                {data.profitTrend.map((d, i) => {
                  const maxG = Math.max(1, ...data.profitTrend.map((x) => Math.max(x.gross, 0)));
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 2, height: '100%' }} title={`${fmtDate(d.label)} — মূল: ${fmtTaka(d.gross)}, নিট: ${fmtTaka(d.net)}`}>
                      <div style={{ flex: 1, minHeight: 2, height: `${Math.max(2, (Math.max(d.gross, 0) / maxG) * 100)}%`, background: '#9adbc4', borderRadius: 3 }} />
                      <div style={{ flex: 1, minHeight: 2, height: `${Math.max(2, (Math.max(d.net, 0) / maxG) * 100)}%`, background: 'var(--c-primary)', borderRadius: 3 }} />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 'var(--fs-xs)', color: 'var(--c-ink-2)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: '#9adbc4', display: 'inline-block' }} /> মূল লব্ধি
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--c-primary)', display: 'inline-block' }} /> নিট লাভ
                </span>
              </div>
            </ChartCard>
          )}
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <ChartCard title="পেমেন্ট মেথড (সময়ে)">
            {data.paymentMix.length === 0 ? (
              <Empty title="কোনো বিক্রয় নেই" compact />
            ) : (
              data.paymentMix.map((p) => (
                <div key={p.method} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 'var(--fs-sm)' }}>
                  <span>{paymentMethodLabel(p.method)}</span>
                  <Money paise={p.total} />
                </div>
              ))
            )}
          </ChartCard>

          <div className="card card-pad">
            <div className="card-title" style={{ fontSize: 'var(--fs-md)' }}>
              <PackageX size={15} style={{ color: 'var(--c-danger)' }} /> স্টক সতর্কতা
            </div>
            {data.outOfStock.length === 0 && data.lowStock.length === 0 ? (
              <Empty title="সব পণ্যের স্টক আছে" compact sub="কম স্টক বা শেষ স্টক নেই।" />
            ) : (
              <>
                {data.outOfStock.slice(0, 4).map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', padding: '4px 0' }}>
                    <span>{p.name}</span>
                    <span className="badge badge-red">শেষ</span>
                  </div>
                ))}
                {data.lowStock.slice(0, 4).map((p, i) => (
                  <div key={`l${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', padding: '4px 0' }}>
                    <span>{p.name}</span>
                    <span className="badge badge-amber">বাকি {p.quantity}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginTop: 16 }}>
        <div className="card card-pad">
          <div className="card-title" style={{ fontSize: 'var(--fs-md)' }}>সেরা বিক্রিত পণ্য</div>
          {data.topProducts.length === 0 ? (
            <Empty title="এই সময়ে বিক্রয় নেই" compact />
          ) : (
            data.topProducts.slice(0, 5).map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', fontSize: 'var(--fs-sm)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i + 1}. {p.name} <span style={{ color: 'var(--c-ink-3)' }}>×{p.qty}</span>
                </span>
                <Money paise={p.revenue} />
              </div>
            ))
          )}
        </div>

        <div className="card card-pad">
          <div className="card-title" style={{ fontSize: 'var(--fs-md)' }}>সর্বাধিক বকেয়া (কাস্টমার)</div>
          {data.topCustomerDues.length === 0 ? (
            <Empty title="কোনো বকেয়া নেই" compact />
          ) : (
            data.topCustomerDues.slice(0, 5).map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 'var(--fs-sm)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <Money paise={c.due_balance_paise} />
              </div>
            ))
          )}
        </div>

        <div className="card card-pad">
          <div className="card-title" style={{ fontSize: 'var(--fs-md)' }}>সর্বাধিক প্রদেয় (সাপ্লায়ার)</div>
          {data.topSupplierPayables.length === 0 ? (
            <Empty title="কোনো বকেয়া নেই" compact />
          ) : (
            data.topSupplierPayables.slice(0, 5).map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 'var(--fs-sm)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <Money paise={s.payable_balance_paise} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
