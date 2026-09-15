/** Suppliers — payable ledger, payments. */
import React, { useMemo, useState } from 'react';
import { Truck, Plus, Search, Pencil, Banknote, BookOpen } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, DataTable, type Col, Modal, Field, TextInput, Money, useToast, fmtDate } from '../../ui';
import { toPaise, fromPaise } from '@shared/money';
import { PAYMENT_METHODS, paymentMethodLabel } from '@shared/payments';

export function Suppliers() {
  const { user, can } = useSession();
  const token = user!.token;
  const [search, setSearch] = useState('');
  const [onlyPayable, setOnlyPayable] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [ledger, setLedger] = useState<Row | null>(null);
  const [paying, setPaying] = useState<Row | null>(null);

  const { data, reload } = useAsync(
    async () =>
      await api.suppliers.list(token, { search: search || undefined, onlyWithPayable: onlyPayable || undefined, limit: 50, offset: page * 50 }),
    [token, search, onlyPayable, page]
  );

  const rows = useMemo(() => (data?.rows ?? []) as Row[], [data]);

  const cols: Col<Row>[] = [
    { key: 'name', label: 'নাম', render: (r) => <strong>{String(r.name)}</strong> },
    { key: 'phone', label: 'ফোন', render: (r) => <span className="money">{String(r.phone ?? '—')}</span> },
    { key: 'address', label: 'ঠিকানা', render: (r) => String(r.address ?? '—') },
    {
      key: 'payable_balance_paise', label: 'প্রদেয়', align: 'right', render: (r) => {
        const d = (r.payable_balance_paise as number) ?? 0;
        return d > 0 ? <span style={{ color: 'var(--c-warn)', fontWeight: 700 }}><Money paise={d} /></span> : <span style={{ color: 'var(--c-ink-3)' }}>—</span>;
      }
    },
    {
      key: 'actions', label: '', align: 'right', render: (r) => (
        <div className="tbl-row-actions" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<BookOpen size={13} />} onClick={() => setLedger(r)}>বহি</Button>
          {can('suppliers.pay') && ((r.payable_balance_paise as number) ?? 0) > 0 && (
            <Button size="sm" variant="primary" icon={<Banknote size={13} />} onClick={() => setPaying(r)}>পেমেন্ট</Button>
          )}
          {can('suppliers.manage') && (
            <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(r)}>সম্পাদনা</Button>
          )}
        </div>
      )
    }
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">সাপ্লায়ার</div>
          <div className="page-sub">প্রদেয় ও সাপ্লায়ারের হিসাব</div>
        </div>
        <div className="toolbar">
          <label className="checkbox-row">
            <input type="checkbox" checked={onlyPayable} onChange={(e) => { setOnlyPayable(e.target.checked); setPage(0); }} />
            শুধু প্রদেয়
          </label>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--c-ink-3)' }} />
            <TextInput style={{ paddingLeft: 30 }} placeholder="নাম / ফোন…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          {can('suppliers.manage') && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>নতুন সাপ্লায়ার</Button>
          )}
        </div>
      </div>

      <DataTable
        cols={cols}
        rows={rows}
        onRow={(r) => setLedger(r)}
        emptyTitle="এখনো কোনো সাপ্লায়ার নেই"
        emptySub="সাপ্লায়ার যোগ করলে ক্রয় আর প্রদেয়ের হিসাব এখানে হবে।"
        emptyIcon={<Truck size={20} />}
      />

      {(data?.total ?? 0) > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>পূর্বের</Button>
          <Button variant="outline" disabled={(page + 1) * 50 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>পরবর্তী</Button>
        </div>
      )}

      {editing && <SupplierFormModal supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {ledger && <LedgerModal token={token} supplier={ledger} onClose={() => setLedger(null)} />}
      {paying && <PayModal token={token} supplier={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
    </div>
  );
}

function SupplierFormModal({ supplier, onClose, onSaved }: { supplier: Row | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [name, setName] = useState(supplier ? String(supplier.name ?? '') : '');
  const [phone, setPhone] = useState(supplier ? String(supplier.phone ?? '') : '');
  const [address, setAddress] = useState(supplier ? String(supplier.address ?? '') : '');
  const [openingPayable, setOpeningPayable] = useState(0);
  const [busy, setBusy] = useState(false);
  const isEdit = !!supplier;

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (isEdit) {
        await api.suppliers.update(token, { id: String(supplier!.id), name: name.trim(), phone: phone.trim(), address: address.trim() });
        toast('success', 'সাপ্লায়ার হালনাগাদ হয়েছে', name);
      } else {
        await api.suppliers.create(token, {
          name: name.trim(), phone: phone.trim(), address: address.trim(),
          openingPayablePaise: toPaise(openingPayable)
        });
        toast('success', 'সাপ্লায়ার যোগ হয়েছে', name);
      }
      onSaved();
    } catch (e) {
      toast('error', isEdit ? 'হালনাগাদ হয়নি' : 'যোগ করা যায়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isEdit ? 'সাপ্লায়ার সম্পাদনা' : 'নতুন সাপ্লায়ার'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>{isEdit ? 'সংরক্ষণ করুন' : 'যোগ করুন'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="নাম *">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="সাপ্লায়ারের নাম" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="ফোন">
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="০১XXXXXXXXX" />
          </Field>
          {!isEdit && (
            <Field label="আগের বকেয়া (৳)" hint="আগের ব্যবসার প্রদেয়">
              <TextInput inputMode="decimal" className="input-money" value={openingPayable || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setOpeningPayable(Number.isFinite(v) ? v : 0); }} />
            </Field>
          )}
        </div>
        <Field label="ঠিকানা">
          <TextInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ঐচ্ছিক" />
        </Field>
      </div>
    </Modal>
  );
}

function LedgerModal({ token, supplier, onClose }: { token: string; supplier: Row; onClose: () => void }) {
  const { data } = useAsync(async () => (await api.suppliers.ledger(token, String(supplier.id))) as Row[], [token, supplier.id]);
  const rows = (data ?? []) as Row[];
  const runningBalance = useMemo(() => {
    const map = new Map<string, number>();
    let b = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const t = String(r.transaction_type ?? '');
      const amt = (r.amount_paise as number) ?? 0;
      b += t === 'purchase' || t === 'opening' ? amt : -amt;
      map.set(String(r.id), b);
    }
    return map;
  }, [rows]);
  return (
    <Modal title={`বহি — ${String(supplier.name)}`} size="lg" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>বন্ধ করুন</Button>}>
      <div className="detail-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="detail-cell"><div className="k">বর্তমান প্রদেয়</div><div className="v" style={{ color: 'var(--c-warn)' }}><Money paise={(supplier.payable_balance_paise as number) ?? 0} /></div></div>
        <div className="detail-cell"><div className="k">ফোন</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}>{String(supplier.phone ?? '—')}</div></div>
        <div className="detail-cell"><div className="k">ঠিকানা</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}>{String(supplier.address ?? '—')}</div></div>
      </div>
      <DataTable
        cols={[
          { key: 'created_at', label: 'তারিখ', render: (r) => fmtDate((r.created_at as number) ?? null) },
          {
            key: 'transaction_type', label: 'ধরন', render: (r) => {
              const t = String(r.transaction_type ?? '');
              const map: Record<string, { label: string; cls: string }> = {
                purchase: { label: 'ক্রয় (বকেয়া)', cls: 'badge-amber' },
                payment: { label: 'পেমেন্ট', cls: 'badge-green' },
                opening: { label: 'প্রাথমিক', cls: 'badge-gray' },
                purchase_return: { label: 'ক্রয় ফেরত', cls: 'badge-red' }
              };
              const m = map[t] ?? { label: t, cls: 'badge-gray' };
              return <span className={`badge ${m.cls}`}>{m.label}</span>;
            }
          },
          { key: 'reference_no', label: 'রেফারেন্স', render: (r) => String(r.reference_no ?? '—') },
          { key: 'amount_paise', label: 'পরিমাণ', align: 'right', render: (r) => <Money paise={(r.amount_paise as number) ?? 0} /> },
          { key: 'balance_after', label: 'দেযাদা (পর)', align: 'right', render: (r) => <strong><Money paise={runningBalance.get(String(r.id)) ?? 0} /></strong> },
        ]}
        rows={rows}
        emptyTitle="কোনো লেনদেন নেই"
        emptySub="এই সাপ্লায়ারের সাথে এখনো কোনো ক্রয়/পেমেন্ট হয়নি।"
      />
    </Modal>
  );
}

function PayModal({ token, supplier, onClose, onDone }: { token: string; supplier: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const payable = (supplier.payable_balance_paise as number) ?? 0;
  const [amount, setAmount] = useState(fromPaise(payable));
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (amount <= 0) return;
    setBusy(true);
    try {
      const res = await api.suppliers.pay(token, { supplierId: String(supplier.id), amountPaise: toPaise(amount), method }, idemKey());
      toast('success', 'পেমেন্ট সম্পন্ন', `রেফারেন্স: ${res.referenceNo}`);
      onDone();
    } catch (e) {
      toast('error', 'পেমেন্ট করা যায়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`সাপ্লায়ার পেমেন্ট — ${String(supplier.name)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={amount <= 0} onClick={save}>পেমেন্ট করুন</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="detail-cell" style={{ background: 'var(--c-warn-soft)' }}>
          <div className="k">বর্তমান প্রদেয়</div>
          <div className="v" style={{ color: 'var(--c-warn)' }}><Money paise={payable} /></div>
        </div>
        <Field label="পেমেন্টের পরিমাণ (৳)">
          <TextInput inputMode="decimal" className="input-money" value={amount || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setAmount(Number.isFinite(v) ? v : 0); }} autoFocus />
        </Field>
        <Field label="পেমেন্ট মাধ্যম">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PAYMENT_METHODS.filter((m) => m.key !== 'cheque').map((m) => (
              <button key={m.key} className={`pay-btn${method === m.key ? ' selected' : ''}`} style={{ width: 'auto', padding: '7px 12px' }} onClick={() => setMethod(m.key)}>
                {paymentMethodLabel(m.key)}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
