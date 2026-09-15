/** MFS agent — manual recording of agent operations (no provider API,
 *  per §152). Wallet float, commission rules, reconciliation. */
import React, { useMemo, useState } from 'react';
import { Smartphone, Plus, Scale, Settings2, RefreshCw } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, DataTable, type Col, Modal, Field, TextInput, SelectInput, Money, useToast, fmtDateTime, Tabs } from '../../ui';
import { toPaise } from '@shared/money';

export function Mfs() {
  const { user, can } = useSession();
  const token = user!.token;
  const [tab, setTab] = useState('transactions');
  const [adding, setAdding] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [reconProvider, setReconProvider] = useState('');

  const { data: providers, reload: reloadProviders } = useAsync(async () => (await api.mfs.providers(token)) as Row[], [token]);
  const [providerFilter, setProviderFilter] = useState('');

  const { data, reload } = useAsync(
    async () =>
      await api.mfs.query(token, {
        providerId: providerFilter || undefined,
        from: sevenDaysAgo(),
        to: Date.now(),
        limit: 100
      }),
    [token, providerFilter]
  );

  const rows = useMemo(() => (data?.rows ?? []) as Row[], [data]);

  const TYPE_LABEL: Record<string, { label: string; cls: string; dir: 1 | -1 }> = {
    cash_in: { label: 'ক্যাশ-ইন', cls: 'badge-green', dir: 1 },
    cash_out: { label: 'ক্যাশ-আউট', cls: 'badge-red', dir: -1 },
    send_money: { label: 'সেন্ড মানি', cls: 'badge-blue', dir: 1 },
    other: { label: 'অন্যান্য', cls: 'badge-gray', dir: 1 }
  };

  const cols: Col<Row>[] = [
    { key: 'reference_no', label: 'রেফারেন্স', render: (r) => <strong>{String(r.reference_no)}</strong> },
    { key: 'created_at', label: 'তারিখ', render: (r) => fmtDateTime((r.created_at as number) ?? null) },
    { key: 'provider_name', label: 'প্রভাইডার', render: (r) => String(r.provider_name ?? '—') },
    {
      key: 'transaction_type', label: 'ধরন', render: (r) => {
        const t = TYPE_LABEL[String(r.transaction_type)] ?? TYPE_LABEL.other;
        return <span className={`badge ${t.cls}`}>{t.label}</span>;
      }
    },
    { key: 'customer_name', label: 'কাস্টমার', render: (r) => String(r.customer_name ?? '—') },
    {
      key: 'amount_paise', label: 'পরিমাণ', align: 'right', render: (r) => {
        const t = TYPE_LABEL[String(r.transaction_type)];
        const a = (r.amount_paise as number) ?? 0;
        return <strong style={{ color: t?.dir === -1 ? 'var(--c-danger)' : 'var(--c-success)' }}><Money paise={a} sign /></strong>;
      }
    },
    { key: 'commission_paise', label: 'কমিশন', align: 'right', render: (r) => <Money paise={(r.commission_paise as number) ?? 0} /> }
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">MFS এজেন্ট</div>
          <div className="page-sub">হাতে এন্ট্রি করা এজেন্ট লেনদেন — কোনো লাইভ API নেই</div>
        </div>
        <div className="toolbar">
          <Button variant="outline" icon={<Settings2 size={15} />} onClick={() => setRulesOpen(true)}>কমিশন নিয়ম</Button>
          {can('mfs.create') && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>নতুন লেনদেন</Button>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        {(providers ?? []).map((p) => (
          <div key={String(p.id)} className="stat" style={{ cursor: 'pointer', borderColor: providerFilter === p.id ? 'var(--c-primary)' : undefined }} onClick={() => setProviderFilter(providerFilter === p.id ? '' : String(p.id))}>
            <div className="stat-label"><Smartphone size={15} /> {String(p.name)} ওয়ালেট</div>
            <div className="stat-value" style={{ color: 'var(--c-primary)' }}><Money paise={(p.wallet_balance_paise as number) ?? 0} /></div>
            {p.wallet_account_no ? <div className="stat-sub">হিসাব: {String(p.wallet_account_no)}</div> : null}
          </div>
        ))}
      </div>

      <Tabs
        tabs={[
          { key: 'transactions', label: 'লেনদেন (গত ৭ দিন)' },
          { key: 'reconciliation', label: 'রিকনসিলিয়েশন' }
        ]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ height: 14 }} />

      {tab === 'transactions' && (
        <DataTable
          cols={cols}
          rows={rows}
          emptyTitle="গত ৭ দিনে কোনো এজেন্ট লেনদেন নেই"
          emptySub="ক্যাশ-ইন, ক্যাশ-আউট বা সেন্ড মানি এখানে ম্যানুয়ালি লিখলে দেখা যাবে।"
          emptyIcon={<Smartphone size={20} />}
        />
      )}

      {tab === 'reconciliation' && (
        <div>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <SelectInput value={reconProvider || (providers?.[0]?.id as string)} onChange={(e) => setReconProvider(e.target.value)} style={{ width: 200 }}>
              {(providers ?? []).map((p) => (
                <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>
              ))}
            </SelectInput>
            <Button icon={<RefreshCw size={15} />} onClick={() => reload()}>রিফ্রেশ</Button>
          </div>
          <ReconciliationCard token={token} providerId={reconProvider || String(providers?.[0]?.id ?? '')} />
        </div>
      )}

      {adding && (
        <MfsTxnModal
          providers={(providers ?? []) as Row[]}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reload();
            reloadProviders();
          }}
        />
      )}

      {rulesOpen && <CommissionRulesModal providers={(providers ?? []) as Row[]} onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

function sevenDaysAgo(): number {
  return Date.now() - 7 * 86_400_000;
}

function ReconciliationCard({ token, providerId }: { token: string; providerId: string }) {
  const { data, busy } = useAsync(
    async () => (await api.mfs.reconciliation(token, { providerId, from: undefined, to: undefined })) as Row,
    [token, providerId]
  );
  if (busy || !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }
  const variance = (data.variancePaise as number) ?? 0;
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat"><div className="stat-label">প্রাথমিক</div><div className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}><Money paise={(data.openingBalancePaise as number) ?? 0} /></div></div>
        <div className="stat"><div className="stat-label">মোট ক্যাশ-ইন</div><div className="stat-value" style={{ fontSize: 'var(--fs-xl)', color: 'var(--c-success)' }}><Money paise={(data.cashInPaise as number) ?? 0} /></div></div>
        <div className="stat"><div className="stat-label">মোট ক্যাশ-আউট</div><div className="stat-value" style={{ fontSize: 'var(--fs-xl)', color: 'var(--c-danger)' }}><Money paise={(data.cashOutPaise as number) ?? 0} /></div></div>
        <div className="stat"><div className="stat-label">আসলে ওয়ালেটে</div><div className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}><Money paise={(data.walletBalancePaise as number) ?? 0} /></div></div>
        <div className="stat" style={{ borderColor: variance === 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>
          <div className="stat-label"><Scale size={15} /> তারতম্য</div>
          <div className="stat-value" style={{ fontSize: 'var(--fs-xl)', color: variance === 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>
            {variance === 0 ? 'মিলেছে' : <Money paise={variance} sign />}
          </div>
          <div className="stat-sub">{(data.transactionCount as number) ?? 0}টি লেনদেন</div>
        </div>
      </div>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-3)', marginTop: 10 }}>
        হিসাব: প্রাথমিক + ক্যাশ-ইন − ক্যাশ-আউট = আসলে থাকা ওয়ালেট। মেললে ব্যবসার বই ঠিক আছে।
      </p>
    </div>
  );
}

function MfsTxnModal({ providers, onClose, onDone }: { providers: Row[]; onClose: () => void; onDone: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [providerId, setProviderId] = useState(String(providers[0]?.id ?? ''));
  const [type, setType] = useState('cash_in');
  const [amount, setAmount] = useState(0);
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!providerId || amount <= 0) return;
    setBusy(true);
    try {
      const res = await api.mfs.create(
        token,
        {
          providerId,
          transactionType: type,
          amountPaise: toPaise(amount),
          customerName: customer.trim() || undefined,
          customerPhone: phone.trim() || undefined,
          txnRef: ref.trim() || undefined
        },
        idemKey()
      );
      toast('success', 'MFS লেনদেন লেখা হয়েছে', `রেফারেন্স: ${res.referenceNo}${res.commissionPaise ? `, কমিশন: ${formatBdtBn(res.commissionPaise)}` : ''}`);
      onDone();
    } catch (e) {
      toast('error', 'লেখা যায়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="নতুন MFS লেনদেন"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={!providerId || amount <= 0} onClick={save}>যোগ করুন</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="প্রভাইডার">
            <SelectInput value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {providers.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>
              ))}
            </SelectInput>
          </Field>
          <Field label="লেনদেনের ধরন">
            <SelectInput value={type} onChange={(e) => setType(e.target.value)}>
              <option value="cash_in">ক্যাশ-ইন (মোবাইল অ্যাকাউন্টে ডিপোজিট)</option>
              <option value="cash_out">ক্যাশ-আউট (নগদ প্রদান)</option>
              <option value="send_money">সেন্ড মানি (কাস্টমার পেমেন্ট)</option>
              <option value="other">অন্যান্য</option>
            </SelectInput>
          </Field>
        </div>
        <Field label="পরিমাণ (৳) *">
          <TextInput inputMode="decimal" className="input-money" value={amount || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setAmount(Number.isFinite(v) ? v : 0); }} autoFocus />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="কাস্টমারের নাম">
            <TextInput value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="ঐচ্ছিক" />
          </Field>
          <Field label="কাস্টমার ফোন">
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="ঐচ্ছিক" />
          </Field>
        </div>
        <Field label="প্রভাইডারের লেনদেন নং" hint="bKash/Nagad-এর ট্রানজেকশন রেফারেন্স">
          <TextInput value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ঐচ্ছিক" />
        </Field>
      </div>
    </Modal>
  );
}

function CommissionRulesModal({ providers, onClose }: { providers: Row[]; onClose: () => void }) {
  const { user, can } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [rules, setRules] = useState<Row[] | null>(null);
  const [providerId, setProviderId] = useState(String(providers[0]?.id ?? ''));
  const [type, setType] = useState('cash_in');
  const [mode, setMode] = useState<'rate' | 'fixed'>('rate');
  const [rate, setRate] = useState(0);
  const [fixed, setFixed] = useState(0);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(0);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        setRules(await api.mfs.commission.list(token));
      } catch {
        setRules([]);
      }
    })();
  }, [token]);

  async function save() {
    if (!providerId) return;
    setBusy(true);
    try {
      await api.mfs.commission.save(token, {
        providerId,
        transactionType: type,
        rateBps: mode === 'rate' ? Math.round(rate * 100) : 0,
        fixedAmountPaise: mode === 'fixed' ? toPaise(fixed) : 0,
        minPaise: toPaise(min),
        maxPaise: toPaise(max)
      });
      toast('success', 'কমিশন নিয়ম সংরক্ষিত');
      const r = await api.mfs.commission.list(token);
      setRules(r);
    } catch (e) {
      toast('error', 'সংরক্ষণ হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const current = (rules ?? []).find((r) => String(r.provider_id) === providerId && String(r.transaction_type) === type);

  return (
    <Modal
      title="কমিশন নিয়ম"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বন্ধ করুন</Button>
          {can('mfs.manage') && (
            <Button variant="primary" loading={busy} onClick={save}>নিয়ম সংরক্ষণ</Button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="প্রভাইডার">
            <SelectInput value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {providers.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>
              ))}
            </SelectInput>
          </Field>
          <Field label="লেনদেনের ধরন">
            <SelectInput value={type} onChange={(e) => setType(e.target.value)}>
              <option value="cash_in">ক্যাশ-ইন</option>
              <option value="cash_out">ক্যাশ-আউট</option>
              <option value="send_money">সেন্ড মানি</option>
              <option value="other">অন্যান্য</option>
            </SelectInput>
          </Field>
          <Field label="ধরন">
            <SelectInput value={mode} onChange={(e) => setMode(e.target.value as 'rate' | 'fixed')}>
              <option value="rate">শতাংশ হার</option>
              <option value="fixed">স্থির অর্থ</option>
            </SelectInput>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {mode === 'rate' ? (
            <Field label="হার (%)">
              <TextInput inputMode="decimal" value={rate || ''} placeholder="যেমন: 1.5" onChange={(e) => { const v = Number(e.target.value); setRate(Number.isFinite(v) ? v : 0); }} />
            </Field>
          ) : (
            <Field label="স্থির কমিশন (৳)">
              <TextInput inputMode="decimal" className="input-money" value={fixed || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setFixed(Number.isFinite(v) ? v : 0); }} />
            </Field>
          )}
          <Field label="সর্বনিম্ন (৳)">
            <TextInput inputMode="decimal" className="input-money" value={min || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setMin(Number.isFinite(v) ? v : 0); }} />
          </Field>
          <Field label="সর্বোচ্চ (৳)">
            <TextInput inputMode="decimal" className="input-money" value={max || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setMax(Number.isFinite(v) ? v : 0); }} />
          </Field>
        </div>
        {current && (
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>
            বর্তমান নিয়ম: {(current.rate_bps as number) ? `${((current.rate_bps as number) / 100).toLocaleString('en-IN')}%` : `৳${(((current.fixed_amount_paise as number) ?? 0) / 100).toLocaleString('en-IN')}`}
            {(current.min_paise as number) ? ` (ন্যূনতম ৳${((current.min_paise as number) / 100).toLocaleString('en-IN')})` : ''}
            {(current.max_paise as number) ? ` (সর্বোচ্চ ৳${((current.max_paise as number) / 100).toLocaleString('en-IN')})` : ''}
          </p>
        )}
        <div className="table-wrap" style={{ borderRadius: 10 }}>
          <table className="tbl">
            <thead>
              <tr><th>প্রভাইডার</th><th>ধরন</th><th>নিয়ম</th></tr>
            </thead>
            <tbody>
              {(rules ?? []).length === 0 && (
                <tr><td colSpan={3} style={{ color: 'var(--c-ink-3)', textAlign: 'center', padding: 16 }}>কোনো নিয়ম নেই — এখনো কোনো কমিশন ধরা হবে না</td></tr>
              )}
              {(rules ?? []).map((r) => (
                <tr key={String(r.id)}>
                  <td>{String(r.provider_name)}</td>
                  <td>{String(r.transaction_type)}</td>
                  <td>
                    {(r.rate_bps as number) ? `${((r.rate_bps as number) / 100).toLocaleString('en-IN')}%` : `৳${(((r.fixed_amount_paise as number) ?? 0) / 100).toLocaleString('en-IN')}`}
                    {(r.min_paise as number) || (r.max_paise as number) ? (
                      <span style={{ color: 'var(--c-ink-3)', marginLeft: 6 }}>
                        (ন্যূনতম ৳{(((r.min_paise as number) ?? 0) / 100).toLocaleString('en-IN')} / সর্বোচ্চ ৳{(((r.max_paise as number) ?? 0) / 100).toLocaleString('en-IN')})
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function formatBdtBn(paise: number): string {
  const s = (paise / 100).toLocaleString('en-IN');
  const map: Record<string, string> = { '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪', '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯' };
  return `৳${s.replace(/\d/g, (d) => map[d])}`;
}
