/** Customers — credit ledger, dues, collection. */
import React, { useMemo, useState } from 'react';
import { Users, Plus, Search, Pencil, Banknote, BookOpen } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, DataTable, type Col, Modal, Field, TextInput, Money, useToast, fmtDate } from '../../ui';
import { toPaise, fromPaise } from '@shared/money';
import { PAYMENT_METHODS, paymentMethodLabel } from '@shared/payments';

export function Customers() {
  const { user, can } = useSession();
  const token = user!.token;
  const [search, setSearch] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [ledger, setLedger] = useState<Row | null>(null);
  const [collecting, setCollecting] = useState<Row | null>(null);

  const { data, busy, reload } = useAsync(
    async () =>
      await api.customers.list(token, { search: search || undefined, onlyWithDue: onlyDue || undefined, limit: 50, offset: page * 50 }),
    [token, search, onlyDue, page]
  );

  const rows = useMemo(() => (data?.rows ?? []) as Row[], [data]);

  const cols: Col<Row>[] = [
    { key: 'name', label: 'নাম', render: (r) => <strong>{String(r.name)}</strong> },
    { key: 'phone', label: 'ফোন', render: (r) => <span className="money">{String(r.phone ?? '—')}</span> },
    { key: 'address', label: 'ঠিকানা', render: (r) => String(r.address ?? '—') },
    {
      key: 'due_balance_paise', label: 'বকেয়া', align: 'right', render: (r) => {
        const d = (r.due_balance_paise as number) ?? 0;
        return d > 0 ? <span style={{ color: 'var(--c-danger)', fontWeight: 700 }}><Money paise={d} /></span> : <span style={{ color: 'var(--c-ink-3)' }}>—</span>;
      }
    },
    {
      key: 'actions', label: '', align: 'right', render: (r) => (
        <div className="tbl-row-actions" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<BookOpen size={13} />} onClick={() => setLedger(r)}>বহি</Button>
          {can('customers.collect') && ((r.due_balance_paise as number) ?? 0) > 0 && (
            <Button size="sm" variant="primary" icon={<Banknote size={13} />} onClick={() => setCollecting(r)}>আদায়</Button>
          )}
          {can('customers.manage') && (
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
          <div className="page-title">কাস্টমার</div>
          <div className="page-sub">বকেয়া ও উজড় হিসাব</div>
        </div>
        <div className="toolbar">
          <label className="checkbox-row">
            <input type="checkbox" checked={onlyDue} onChange={(e) => { setOnlyDue(e.target.checked); setPage(0); }} />
            শুধু বকেয়াধন
          </label>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--c-ink-3)' }} />
            <TextInput style={{ paddingLeft: 30 }} placeholder="নাম / ফোন…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          {can('customers.manage') && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>নতুন কাস্টমার</Button>
          )}
        </div>
      </div>

      <DataTable
        cols={cols}
        rows={rows}
        onRow={(r) => setLedger(r)}
        emptyTitle="এখনো কোনো কাস্টমার নেই"
        emptySub="বকেয়া-বিরত বিক্রয়ের জন্য কাস্টমার তৈরি করুন।"
        emptyIcon={<Users size={20} />}
      />

      {(data?.total ?? 0) > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>পূর্বের</Button>
          <Button variant="outline" disabled={(page + 1) * 50 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>পরবর্তী</Button>
        </div>
      )}

      {editing && <CustomerFormModal customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {ledger && <LedgerModal token={token} customer={ledger} onClose={() => setLedger(null)} />}
      {collecting && <CollectModal token={token} customer={collecting} onClose={() => setCollecting(null)} onDone={() => { setCollecting(null); reload(); }} />}
    </div>
  );
}

function CustomerFormModal({ customer, onClose, onSaved }: { customer: Row | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [name, setName] = useState(customer ? String(customer.name ?? '') : '');
  const [phone, setPhone] = useState(customer ? String(customer.phone ?? '') : '');
  const [address, setAddress] = useState(customer ? String(customer.address ?? '') : '');
  const [creditLimit, setCreditLimit] = useState(customer ? fromPaise((customer.credit_limit_paise as number) ?? 0) : 0);
  const [openingDue, setOpeningDue] = useState(0);
  const [busy, setBusy] = useState(false);
  const isEdit = !!customer;

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (isEdit) {
        await api.customers.update(token, {
          id: String(customer!.id),
          name: name.trim(), phone: phone.trim(), address: address.trim(),
          creditLimitPaise: toPaise(creditLimit)
        });
        toast('success', 'কাস্টমার হালনাগাদ হয়েছে', name);
      } else {
        await api.customers.create(token, {
          name: name.trim(), phone: phone.trim(), address: address.trim(),
          creditLimitPaise: toPaise(creditLimit),
          openingDuePaise: toPaise(openingDue)
        });
        toast('success', 'কাস্টমার যোগ হয়েছে', name);
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
      title={isEdit ? 'কাস্টমার সম্পাদনা' : 'নতুন কাস্টমার'}
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
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="কাস্টমারের নাম" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="ফোন">
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="০১XXXXXXXXX" />
          </Field>
          <Field label="উজড় সীমা (৳)" hint="এই মাত্রার বেশি বকেয়াতে সতর্কতা">
            <TextInput inputMode="decimal" className="input-money" value={creditLimit || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setCreditLimit(Number.isFinite(v) ? v : 0); }} />
          </Field>
        </div>
        <Field label="ঠিকানা">
          <TextInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ঐচ্ছিক" />
        </Field>
        {!isEdit && (
          <Field label="আগের থেকে বকেয়া (৳)" hint="যদি আগের ব্যবসার বকেয়া থাকে">
            <TextInput inputMode="decimal" className="input-money" value={openingDue || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setOpeningDue(Number.isFinite(v) ? v : 0); }} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function LedgerModal({ token, customer, onClose }: { token: string; customer: Row; onClose: () => void }) {
  const { data } = useAsync(async () => (await api.customers.ledger(token, String(customer.id))) as Row[], [token, customer.id]);
  const rows = (data ?? []) as Row[];
  const runningBalance = useMemo(() => {
    const map = new Map<string, number>();
    let b = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const t = String(r.transaction_type ?? '');
      const amt = (r.amount_paise as number) ?? 0;
      b += t === 'sale' || t === 'opening' ? amt : -amt;
      map.set(String(r.id), b);
    }
    return map;
  }, [rows]);
  return (
    <Modal title={`বহি — ${String(customer.name)}`} size="lg" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>বন্ধ করুন</Button>}>
      <div className="detail-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="detail-cell"><div className="k">বর্তমান বকেয়া</div><div className="v" style={{ color: 'var(--c-danger)' }}><Money paise={(customer.due_balance_paise as number) ?? 0} /></div></div>
        <div className="detail-cell"><div className="k">ফোন</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}>{String(customer.phone ?? '—')}</div></div>
        <div className="detail-cell"><div className="k">ঠিকানা</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}>{String(customer.address ?? '—')}</div></div>
      </div>
      <DataTable
        cols={[
          { key: 'created_at', label: 'তারিখ', render: (r) => fmtDate((r.created_at as number) ?? null) },
          {
            key: 'transaction_type', label: 'ধরন', render: (r) => {
              const t = String(r.transaction_type ?? '');
              const map: Record<string, { label: string; cls: string }> = {
                sale: { label: 'বকেয়া বিক্রয়', cls: 'badge-red' },
                payment: { label: 'বকেয়া আদায়', cls: 'badge-green' },
                opening: { label: 'প্রাথমিক', cls: 'badge-gray' },
                sale_return: { label: 'বিক্রয় ফেরত', cls: 'badge-amber' },
                adjustment: { label: 'সমন্বয়', cls: 'badge-gray' }
              };
              const m = map[t] ?? { label: t, cls: 'badge-gray' };
              return <span className={`badge ${m.cls}`}>{m.label}</span>;
            }
          },
          { key: 'reference_no', label: 'রেফারেন্স', render: (r) => String(r.reference_no ?? '—') },
          { key: 'amount_paise', label: 'পরিমাণ', align: 'right', render: (r) => <Money paise={(r.amount_paise as number) ?? 0} /> },
          { key: 'balance_after', label: 'বকেযা (পর)', align: 'right', render: (r) => <strong><Money paise={runningBalance.get(String(r.id)) ?? 0} /></strong> },
          { key: 'note', label: 'নোট', render: (r) => String(r.note ?? '—') }
        ]}
        rows={rows}
        emptyTitle="কোনো লেনদেন নেই"
        emptySub="এই কাস্টমারের সাথে এখনো কোনো বকেয়া লেনদেন হয়নি।"
      />
    </Modal>
  );
}

function CollectModal({ token, customer, onClose, onDone }: { token: string; customer: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const due = (customer.due_balance_paise as number) ?? 0;
  const [amount, setAmount] = useState(fromPaise(due));
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (amount <= 0) return;
    setBusy(true);
    try {
      const res = await api.customers.collect(token, { customerId: String(customer.id), amountPaise: toPaise(amount), method }, idemKey());
      toast('success', 'বকেয়া আদায় হয়েছে', `রেফারেন্স: ${res.referenceNo}`);
      onDone();
    } catch (e) {
      toast('error', 'আদায় করা যায়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`বকেয়া আদায় — ${String(customer.name)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={amount <= 0} onClick={save}>আদায় করুন</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="detail-cell" style={{ background: 'var(--c-danger-soft)' }}>
          <div className="k">বর্তমান বকেয়া</div>
          <div className="v" style={{ color: 'var(--c-danger)' }}><Money paise={due} /></div>
        </div>
        <Field label="আদায়ের পরিমাণ (৳)">
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
