/** Expenses — record shop spending by category, list with filters. */
import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, DataTable, type Col, Modal, Field, TextInput, SelectInput, Money, useToast, fmtDate, Bn } from '../../ui';
import { toPaise } from '@shared/money';
import { PAYMENT_METHODS, paymentMethodLabel } from '@shared/payments';

export function Expenses() {
  const { user, can } = useSession();
  const token = user!.token;
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [showCatModal, setShowCatModal] = useState(false);
  const toast = useToast();

  const { data: cats, reload: reloadCats } = useAsync(async () => (await api.expenses.categories.list(token)) as Row[], [token]);
  const { data, reload } = useAsync(
    async () =>
      await api.expenses.list(token, {
        search: search || undefined,
        categoryId: categoryId || undefined,
        limit: 50,
        offset: page * 50
      }),
    [token, search, categoryId, page]
  );

  const rows = useMemo(() => (data?.rows ?? []) as Row[], [data]);

  const cols: Col<Row>[] = [
    { key: 'reference_no', label: 'রেফারেন্স', render: (r) => <strong>{String(r.reference_no)}</strong> },
    { key: 'date', label: 'তারিখ', render: (r) => fmtDate((r.date as number) ?? null) },
    { key: 'category_name', label: 'ক্যাটাগরি', render: (r) => String(r.category_name ?? '—') },
    { key: 'note', label: 'বিবরণ', render: (r) => String(r.note ?? '—') },
    { key: 'method', label: 'পেমেন্ট', render: (r) => paymentMethodLabel(String(r.payment_method ?? 'cash')) },
    {
      key: 'amount_paise', label: 'পরিমাণ', align: 'right', render: (r) => (
        <strong style={{ color: 'var(--c-danger)' }}><Money paise={(r.amount_paise as number) ?? 0} /></strong>
      )
    }
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">খরচ</div>
          <div className="page-sub">মোট <Bn>{data?.total ?? 0}</Bn>টি খরচ</div>
        </div>
        <div className="toolbar">
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--c-ink-3)' }} />
            <TextInput style={{ paddingLeft: 30 }} placeholder="খুঁজুন…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          <SelectInput value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(0); }} style={{ width: 160 }}>
            <option value="">সব ক্যাটাগরি</option>
            {(cats ?? []).map((c) => (
              <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>
            ))}
          </SelectInput>
          {can('settings.manage') && (
            <Button variant="outline" onClick={() => setShowCatModal(true)}>ক্যাটাগরি</Button>
          )}
          {can('expenses.create') && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>নতুন খরচ</Button>
          )}
        </div>
      </div>

      <DataTable
        cols={cols}
        rows={rows}
        emptyTitle="এখনো কোনো খরচ লেখা হয়নি"
        emptySub="দোকানের সব খরচ — ভাড়া, বিদ্যুৎ, বেতন — এখানে লিখুন।"
        emptyIcon={<ClipboardList size={20} />}
      />

      {(data?.total ?? 0) > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>পূর্বের</Button>
          <Button variant="outline" disabled={(page + 1) * 50 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>পরবর্তী</Button>
        </div>
      )}

      {adding && (
        <ExpenseFormModal
          cats={cats ?? []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {showCatModal && (
        <Modal
          title="খরচের ক্যাটাগরি"
          onClose={() => setShowCatModal(false)}
          footer={<Button variant="primary" onClick={() => setShowCatModal(false)}>বন্ধ করুন</Button>}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <TextInput placeholder="নতুন ক্যাটাগরির নাম" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <Button
              variant="primary"
              disabled={!newCat.trim()}
              onClick={() => {
                void (async () => {
                  try {
                    await api.expenses.categories.create(token, newCat.trim());
                    setNewCat('');
                    toast('success', 'ক্যাটাগরি যোগ হয়েছে', newCat);
                    void reloadCats();
                  } catch (e) {
                    toast('error', 'যোগ করা যায়নি', errMsg(e));
                  }
                })();
              }}
            >
              যোগ
            </Button>
          </div>
          <div>
            {(cats ?? []).map((c) => (
              <div key={String(c.id)} style={{ padding: '7px 4px', borderBottom: '1px dashed var(--c-border)', fontSize: 'var(--fs-sm)' }}>
                {String(c.name)}
                {c.is_system ? <span className="badge badge-gray" style={{ marginLeft: 8 }}>সিস্টেম</span> : null}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ExpenseFormModal({
  cats,
  onClose,
  onSaved
}: {
  cats: Row[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [categoryId, setCategoryId] = useState(String(cats[0]?.id ?? ''));
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!categoryId || amount <= 0) return;
    setBusy(true);
    try {
      const res = await api.expenses.create(token, {
        categoryId,
        amountPaise: toPaise(amount),
        method,
        note: note.trim() || undefined
      }, idemKey());
      toast('success', 'খরচ লেখা হয়েছে', `রেফারেন্স: ${res.referenceNo}`);
      onSaved();
    } catch (e) {
      toast('error', 'খরচ লেখা যায়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="নতুন খরচ"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={!categoryId || amount <= 0} onClick={save}>যোগ করুন</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="ক্যাটাগরি *">
          <SelectInput value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {cats.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>
            ))}
          </SelectInput>
        </Field>
        <Field label="পরিমাণ (৳) *">
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
        <Field label="বিবরণ">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="যেমন: এই মাসের বিদ্যুৎ বিল" />
        </Field>
      </div>
    </Modal>
  );
}
