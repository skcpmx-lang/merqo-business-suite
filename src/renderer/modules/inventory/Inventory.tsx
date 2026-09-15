/** Inventory — stock levels, audited adjustments, movement history,
 *  reconcile check. */
import React, { useMemo, useState } from 'react';
import { Boxes, ArrowRightLeft, History, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, DataTable, type Col, StatCard, Modal, Field, TextInput, SelectInput, useToast, Empty, fmtDateTime, Bn, Tabs } from '../../ui';

const ADJUST_TYPES: { key: string; label: string }[] = [
  { key: 'increase', label: 'বৃদ্ধি (গোডোয়ান ভুল)' },
  { key: 'decrease', label: 'কম (সংখ্যা ভুল)' },
  { key: 'damaged', label: 'ক্ষতিগ্রস্ত' },
  { key: 'expired', label: 'মেয়াদোত্তীর্ণ' },
  { key: 'correction', label: 'নির্ভুলন (সঠিক সংখ্যা)' }
];

export function Inventory() {
  const { user, can } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [tab, setTab] = useState('stock');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const [reconcileResult, setReconcileResult] = useState<{ ok: boolean; mismatches: Row[] } | null>(null);

  const { data: summary } = useAsync(async () => (await api.stock.summary(token)) as Row, [token]);
  const { data, busy, reload } = useAsync(
    async () =>
      await api.products.query(token, {
        search: search || undefined,
        lowStockOnly: filter === 'low' || undefined,
        outOfStockOnly: filter === 'out' || undefined,
        limit: 500
      }),
    [token, search, filter]
  );

  const rows = useMemo(() => (data?.rows ?? []) as Row[], [data]);

  const cols: Col<Row>[] = [
    { key: 'name', label: 'পণ্য', render: (r) => <strong>{String(r.name)}</strong> },
    { key: 'unit_name', label: 'একক', render: (r) => String(r.unit_name ?? '—') },
    {
      key: 'current_stock', label: 'বর্তমান', align: 'right', render: (r) => {
        const q = (r.current_stock as number) ?? 0;
        const re = (r.reorder_level as number) ?? 0;
        if (q <= 0) return <span className="badge badge-red">শেষ</span>;
        if (re > 0 && q <= re) return <span className="badge badge-amber"><Bn>{q}</Bn></span>;
        return <Bn>{q}</Bn>;
      }
    },
    { key: 'reorder_level', label: 'অর্ডার সীমা', align: 'right', render: (r) => <Bn>{String(r.reorder_level ?? 0)}</Bn> },
    ...(can('stock.viewCost') ? [{
      key: 'value', label: 'স্টক মূল্য', align: 'right' as const, render: (r: Row) => {
        const q = (r.current_stock as number) ?? 0;
        const cost = (r.avg_cost_paise as number) ?? (r.purchase_price_paise as number) ?? 0;
        return <span>৳{(((q * cost) / 100).toFixed(0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</span>;
      }
    }] : []),
    {
      key: 'actions', label: '', align: 'right', render: (r) => (
        <div className="tbl-row-actions" onClick={(e) => e.stopPropagation()}>
          {can('stock.adjust') && (
            <Button size="sm" variant="outline" icon={<ArrowRightLeft size={13} />} onClick={() => setAdjusting(r)}>
              সমন্বয়
            </Button>
          )}
        </div>
      )
    }
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">ইনভেন্টরি</div>
          <div className="page-sub">স্টকের অবস্থা ও চলাচল</div>
        </div>
        <div className="toolbar">
          <Button
            icon={<ShieldCheck size={15} />}
            onClick={async () => {
              try {
                const r = await api.stock.reconcile(token);
                setReconcileResult(r);
                if (r.ok) toast('success', 'ইনভেন্টরি মিলায়েছে', 'সব পণ্যের স্টক ও চলাচলের হিসাব মিলে গেছে।');
              } catch (e) {
                toast('error', 'চেক করা যায়নি', errMsg(e));
              }
            }}
          >
            হিসাব মিলিয়ে দেখুন
          </Button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCard label="মোট পণ্য" icon={<Boxes size={15} />} value={<Bn>{String(summary?.totalProducts ?? 0)}</Bn>} />
        <StatCard label="কম স্টক" tone="amber" icon={<AlertTriangle size={15} />} value={<Bn>{String(summary?.lowStock ?? 0)}</Bn>} sub="অর্ডার সীমায় বা তার নিচে" />
        <StatCard label="স্টক শেষ" tone="red" icon={<AlertTriangle size={15} />} value={<Bn>{String(summary?.outOfStock ?? 0)}</Bn>} />
        {can('stock.viewCost') ? (
          <StatCard label="স্টকের মূল্য" value={`৳${(((summary?.stockValuePaise as number) ?? 0) / 100).toLocaleString('en-IN')}`} sub="খরচদামে" />
        ) : (
          <StatCard label="মোট একক" value={<Bn>{String(summary?.totalUnits ?? 0)}</Bn>} />
        )}
      </div>

      <div style={{ height: 18 }} />
      <Tabs
        tabs={[
          { key: 'stock', label: 'স্টক তালিকা' },
          { key: 'movements', label: 'চলাচলের ইতিহাস' }
        ]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ height: 14 }} />

      {tab === 'stock' ? (
        <>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <TextInput placeholder="পণ্য খুঁজুন…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
            <SelectInput value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 150 }}>
              <option value="">সব স্টক</option>
              <option value="low">কম স্টক</option>
              <option value="out">স্টক শেষ</option>
            </SelectInput>
          </div>
          <DataTable
            cols={cols}
            rows={rows}
            emptyTitle={filter ? 'এই শর্তে কিছু নেই' : 'কোনো পণ্য নেই'}
            emptySub="পণ্য মডিউল থেকে পণ্য যোগ করুন।"
            emptyIcon={<Boxes size={20} />}
          />
        </>
      ) : (
        <MovementsTable token={token} />
      )}

      {adjusting && (
        <AdjustModal
          token={token}
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null);
            reload();
          }}
        />
      )}

      {reconcileResult && (
        <Modal
          title="ইনভেন্টরি রিকনসিলিয়েশন"
          onClose={() => setReconcileResult(null)}
          footer={<Button variant="primary" onClick={() => setReconcileResult(null)}>বন্ধ করুন</Button>}
        >
          {reconcileResult.ok ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--c-success)', fontWeight: 700 }}>
              <ShieldCheck size={20} /> সব স্টক ও চলাচল হিসাব মিলে গেছে।
            </div>
          ) : (
            <>
              <p style={{ color: 'var(--c-danger)', fontWeight: 700, marginBottom: 10 }}>
                {reconcileResult.mismatches.length}টি পণ্যের হিসাব মেলেনি:
              </p>
              <div>
                {reconcileResult.mismatches.map((m, i) => (
                  <div key={i} style={{ fontSize: 'var(--fs-sm)', padding: '4px 0' }}>
                    {String(m.name)} — স্টকে <strong>{String(m.actual)}</strong>, হিসাবে <strong>{String(m.expected)}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function MovementsTable({ token }: { token: string }) {
  const { data } = useAsync(async () => (await api.stock.movements(token, {})) as Row[], [token]);
  return (
    <DataTable
      cols={[
        { key: 'date', label: 'তারিখ', render: (r) => fmtDateTime((r.created_at as number) ?? null) },
        { key: 'product', label: 'পণ্য', render: (r) => String(r.product_name ?? '—') },
        {
          key: 'type', label: 'ধরন', render: (r) => {
            const t = String(r.movement_type ?? '');
            const map: Record<string, { label: string; cls: string }> = {
              purchase: { label: 'ক্রয়', cls: 'badge-blue' },
              sale: { label: 'বিক্রয়', cls: 'badge-green' },
              sale_void: { label: 'বিক্রয় বাতিল', cls: 'badge-red' },
              sales_return: { label: 'বিক্রয় ফেরত', cls: 'badge-amber' },
              purchase_return: { label: 'ক্রয় ফেরত', cls: 'badge-amber' },
              adjustment: { label: 'সমন্বয়', cls: 'badge-gray' },
              opening_stock: { label: 'প্রাথমিক স্টক', cls: 'badge-gray' }
            };
            const m = map[t] ?? { label: t, cls: 'badge-gray' };
            return <span className={`badge ${m.cls}`}>{m.label}</span>;
          }
        },
        { key: 'quantity', label: 'পরিমাণ', align: 'right', render: (r) => <Bn>{String(r.quantity ?? '')}</Bn> },
        { key: 'reference_no', label: 'রেফারেন্স', render: (r) => String(r.reference_no ?? '—') },
        { key: 'note', label: 'নোট', render: (r) => String(r.note ?? '—') }
      ]}
      rows={(data ?? []) as Row[]}
      emptyTitle="কোনো চলাচল নেই"
      emptySub="বিক্রয়, ক্রয় বা সমন্বয় হলে এখানে দেখা যাবে।"
      emptyIcon={<History size={20} />}
    />
  );
}

function AdjustModal({ token, product, onClose, onDone }: { token: string; product: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [type, setType] = useState('increase');
  const [qty, setQty] = useState('');
  const [targetQty, setTargetQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const current = (product.current_stock as number) ?? 0;

  async function save() {
    setBusy(true);
    try {
      if (type === 'correction') {
        const t = Number(targetQty);
        if (!Number.isFinite(t) || t < 0) throw new Error('সঠিক সংখ্যা লিখুন');
        const diff = t - current;
        await api.stock.adjust(token, {
          productId: String(product.id),
          adjustmentType: 'correction',
          quantity: Math.abs(diff),
          reason: reason.trim() || 'গোডোয়ান পরীক্ষায় সংখ্যা নির্ভুল করা হয়েছে'
        }, idemKey());
      } else {
        const q = Number(qty);
        if (!Number.isFinite(q) || q <= 0) throw new Error('সঠিক পরিমাণ লিখুন');
        if (type === 'decrease' && q > current) throw new Error('বর্তমান স্টক থেকে বেশি কমানো যায় না');
        if (reason.trim().length < 3) throw new Error('কারণ লিখুন');
        await api.stock.adjust(token, {
          productId: String(product.id),
          adjustmentType: type,
          quantity: q,
          reason: reason.trim()
        }, idemKey());
      }
      toast('success', 'স্টক সমন্বয় হয়েছে', String(product.name));
      onDone();
    } catch (e) {
      toast('error', 'সমন্বয় হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`স্টক সমন্বয় — ${String(product.name)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} onClick={save}>সমন্বয় করুন</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)' }}>
          বর্তমান স্টক: <strong><Bn>{current}</Bn></strong> — প্রতিটি সমন্বয় অডিট লগে সংরক্ষিত হবে।
        </p>
        <Field label="সমন্বয়ের ধরন">
          <SelectInput value={type} onChange={(e) => setType(e.target.value)}>
            {ADJUST_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </SelectInput>
        </Field>
        {type === 'correction' ? (
          <Field label="সঠিক মোট সংখ্যা (গোডোয়ানে যা আছে)" hint={`বর্তমান: ${current}`}>
            <TextInput inputMode="decimal" value={targetQty} onChange={(e) => setTargetQty(e.target.value)} autoFocus />
          </Field>
        ) : (
          <Field label="পরিমাণ">
            <TextInput inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="০" autoFocus />
          </Field>
        )}
        {type !== 'correction' && (
          <Field label="কারণ" hint={type === 'damaged' || type === 'expired' ? 'ঐচ্ছিক — কারণ অনুযায়ী হিসাব হয়' : 'ঐচ্ছিক'}>
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'damaged' ? 'যেমন: প্যাকেট ভেঙে গেছে' : type === 'expired' ? 'যেমন: মেয়াদ শেষ' : 'কারণ লিখুন'} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
