/** Accounts — balances, ledger drill-in, internal transfers. */
import React, { useMemo, useState } from 'react';
import { Landmark, ArrowLeftRight } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, DataTable, type Col, Modal, Field, TextInput, SelectInput, Money, useToast, fmtDateTime } from '../../ui';
import { toPaise } from '@shared/money';

export function Accounts() {
  const { user, can } = useSession();
  const token = user!.token;
  const [viewing, setViewing] = useState<Row | null>(null);
  const [transferring, setTransferring] = useState(false);

  const { data: accounts, reload } = useAsync(async () => (await api.accounts.list(token)) as Row[], [token]);

  const totalCash = (accounts ?? []).reduce((s, a) => (a.kind === 'cash' ? s + ((a.balance_paise as number) ?? 0) : s), 0);
  const totalBank = (accounts ?? []).reduce((s, a) => (a.kind === 'bank' ? s + ((a.balance_paise as number) ?? 0) : s), 0);
  const totalMfs = (accounts ?? []).reduce((s, a) => (a.kind === 'mfs' ? s + ((a.balance_paise as number) ?? 0) : s), 0);

  const cols: Col<Row>[] = [
    { key: 'name', label: 'হিসাব', render: (r) => <strong>{String(r.name)}</strong> },
    {
      key: 'kind', label: 'ধরন', render: (r) => {
        const map: Record<string, string> = { cash: 'নগদ', bank: 'ব্যাংক', mfs: 'MFS' };
        return <span className="badge badge-gray">{map[String(r.kind)] ?? String(r.kind)}</span>;
      }
    },
    {
      key: 'balance_paise', label: 'বর্তমান ব্যালেন্স', align: 'right', render: (r) => (
        <strong style={{ color: (r.balance_paise as number) < 0 ? 'var(--c-danger)' : 'var(--c-ink)' }}>
          <Money paise={(r.balance_paise as number) ?? 0} />
        </strong>
      )
    },
    {
      key: 'opening_balance_paise', label: 'প্রাথমিক', align: 'right', render: (r) => <Money paise={(r.opening_balance_paise as number) ?? 0} />
    }
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">হিসাব ও ট্রান্সফার</div>
          <div className="page-sub">নগদ, ব্যাংক, MFS — সব হিসাবের ব্যালেন্স</div>
        </div>
        {can('accounts.transfer') && (
          <Button variant="primary" icon={<ArrowLeftRight size={16} />} onClick={() => setTransferring(true)}>
            ট্রান্সফার
          </Button>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">মোট নগদ</div>
          <div className="stat-value"><Money paise={totalCash} /></div>
        </div>
        <div className="stat">
          <div className="stat-label">মোট ব্যাংক</div>
          <div className="stat-value"><Money paise={totalBank} /></div>
        </div>
        <div className="stat">
          <div className="stat-label">মোট MFS</div>
          <div className="stat-value"><Money paise={totalMfs} /></div>
        </div>
      </div>

      <DataTable
        cols={cols}
        rows={(accounts ?? []) as Row[]}
        onRow={(r) => setViewing(r)}
        emptyTitle="কোনো হিসাব নেই"
        emptySub="সেটআপের সময় সিস্টেম হিসাবগুলো তৈরি হয়ে থাকে।"
        emptyIcon={<Landmark size={20} />}
      />

      {viewing && <AccountLedgerModal token={token} account={viewing} onClose={() => setViewing(null)} />}
      {transferring && (
        <TransferModal
          accounts={(accounts ?? []) as Row[]}
          onClose={() => setTransferring(false)}
          onDone={() => {
            setTransferring(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function AccountLedgerModal({ token, account, onClose }: { token: string; account: Row; onClose: () => void }) {
  const { data, reload } = useAsync(
    async () => (await api.accounts.transactions(token, { accountId: account.id, limit: 200 })) as Row[],
    [token, account.id]
  );
  return (
    <Modal
      title={`লেনদেন — ${String(account.name)}`}
      size="lg"
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>বন্ধ করুন</Button>}
    >
      <div className="detail-cell" style={{ marginBottom: 12 }}>
        <div className="k">বর্তমান ব্যালেন্স</div>
        <div className="v"><Money paise={(account.balance_paise as number) ?? 0} /></div>
      </div>
      <DataTable
        cols={[
          { key: 'created_at', label: 'তারিখ', render: (r) => fmtDateTime((r.created_at as number) ?? null) },
          { key: 'transaction_type', label: 'ধরন', render: (r) => String(r.transaction_type) },
          { key: 'reference_no', label: 'রেফারেন্স', render: (r) => String(r.reference_no ?? '—') },
          { key: 'note', label: 'বিবরণ', render: (r) => String(r.note ?? '—') },
          {
            key: 'amount_paise', label: 'পরিমাণ', align: 'right', render: (r) => {
              const a = (r.amount_paise as number) ?? 0;
              return <span style={{ color: a >= 0 ? 'var(--c-success)' : 'var(--c-danger)', fontWeight: 700 }}><Money paise={a} sign /></span>;
            }
          },
          { key: 'balance_after_paise', label: 'ব্যালেন্স (পর)', align: 'right', render: (r) => <Money paise={(r.balance_after_paise as number) ?? 0} /> }
        ]}
        rows={(data ?? []) as Row[]}
        emptyTitle="কোনো লেনদেন নেই"
      />
    </Modal>
  );
}

function TransferModal({ accounts, onClose, onDone }: { accounts: Row[]; onClose: () => void; onDone: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const token = user!.token;
  const active = accounts.filter((a) => a.is_active);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const fromAcc = active.find((a) => String(a.id) === fromId);

  async function save() {
    if (!fromId || !toId || amount <= 0 || fromId === toId) return;
    setBusy(true);
    try {
      const res = await api.accounts.transfer(token, {
        fromAccountId: fromId,
        toAccountId: toId,
        amountPaise: toPaise(amount),
        note: note.trim() || undefined
      }, idemKey());
      toast('success', 'ট্রান্সফার সম্পন্ন', `রেফারেন্স: ${res.referenceNo}`);
      onDone();
    } catch (e) {
      toast('error', 'ট্রান্সফার হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="হিসাব থেকে হিসাবে ট্রান্সফার"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={!fromId || !toId || fromId === toId || amount <= 0} onClick={save}>
            ট্রান্সফার করুন
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="থেকে">
          <SelectInput value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">নির্বাচন করুন</option>
            {active.map((a) => (
              <option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>
            ))}
          </SelectInput>
        </Field>
        <Field label="একে">
          <SelectInput value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">নির্বাচন করুন</option>
            {active.filter((a) => String(a.id) !== fromId).map((a) => (
              <option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>
            ))}
          </SelectInput>
        </Field>
        <Field label="পরিমাণ (৳) *">
          <TextInput inputMode="decimal" className="input-money" value={amount || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setAmount(Number.isFinite(v) ? v : 0); }} />
        </Field>
        {fromAcc && (
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>
            পাঠানোর হিসাবের ব্যালেন্স: <Money paise={(fromAcc.balance_paise as number) ?? 0} />
          </p>
        )}
        <Field label="বিবরণ">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="যেমন: নগদ ব্যাংকে জমা" />
        </Field>
      </div>
    </Modal>
  );
}
