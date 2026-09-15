/** Cash session (shift) — open with counted cash, close with count,
 *  variance tracking, shift history, daily closing report. */
import React, { useState } from 'react';
import { CircleDollarSign, Power, Lock, FileText } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, Modal, Field, TextInput, Money, useToast, fmtDateTime, DataTable, type Col, Tabs } from '../../ui';
import { toPaise, fromPaise } from '@shared/money';

export function Shift() {
  const { user, can } = useSession();
  const token = user!.token;
  const [tab, setTab] = useState('now');
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);

  const { data: openShift, reload: reloadOpen } = useAsync(async () => (await api.shift.getOpen(token)) as Row | null, [token]);

  if (tab === 'now') {
    return openShift ? (
      <OpenShiftPanel
        token={token}
        shift={openShift}
        onClose={() => setClosing(true)}
      />
    ) : (
      <div>
        <div className="page-head">
          <div>
            <div className="page-title">শিফট / ক্যাশ</div>
            <div className="page-sub">এই মুহূর্তে কোনো শিফট খোলা নেই</div>
          </div>
          {can('shift.open') && (
            <Button variant="primary" icon={<Power size={16} />} onClick={() => setOpening(true)}>
              শিফট খুলুন
            </Button>
          )}
        </div>
        <div className="card card-pad">
          <div className="empty" style={{ padding: 30 }}>
            <div className="empty-icon"><CircleDollarSign size={22} /></div>
            <div className="empty-title">দোকান খুলতে শিফট খুলুন</div>
            <div className="empty-sub">
              প্রাথমিক নগদ টেনে-গুনে লিখুন। দোকান বন্ধের সময় একইভাবে নগদ গণনা করে শিফট বন্ধ করলে
              হিসাবের সাথে মিলে যায় — ফারাক থাকলে সাথে সাথে দেখা যাবে।
            </div>
          </div>
        </div>
        {opening && <OpenModal token={token} onClose={() => setOpening(false)} onDone={() => { setOpening(false); reloadOpen(); }} />}
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">শিফট / ক্যাশ</div>
          <div className="page-sub">শিফটের ইতিহাস ও দৈনিক ক্লোজিং</div>
        </div>
      </div>
      <Tabs tabs={[{ key: 'now', label: 'বর্তমান শিফট' }, { key: 'history', label: 'ইতিহাস' }, { key: 'closing', label: 'দৈনিক ক্লোজিং' }]} active={tab} onChange={setTab} />
      <div style={{ height: 14 }} />
      {tab === 'history' && <ShiftHistory token={token} />}
      {tab === 'closing' && <DailyClosing token={token} />}
      {closing && openShift && (
        <CloseModal
          token={token}
          shift={openShift}
          onClose={() => setClosing(false)}
          onDone={() => {
            setClosing(false);
            reloadOpen();
          }}
        />
      )}
    </div>
  );
}

function OpenShiftPanel({ token, shift, onClose }: { token: string; shift: Row; onClose: () => void }) {
  const { can } = useSession();
  const { data } = useAsync(
    async () => await api.shift.cashSummary(token, (shift.opened_at as number) ?? Date.now(), Date.now()),
    [token, shift.opened_at]
  );
  const opening = (shift.opening_cash_paise as number) ?? 0;
  const movedIn = (data?.cashIn as number) ?? 0;
  const movedOut = (data?.cashOut as number) ?? 0;
  const expected = opening + movedIn - movedOut;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">বর্তমান শিফট</div>
          <div className="page-sub">
            {String(shift.reference_no)} — খোলা: {fmtDateTime((shift.opened_at as number) ?? null)} — {String(shift.user_name ?? '')}
          </div>
        </div>
        {can('shift.close') && (
          <Button variant="primary" icon={<Lock size={16} />} onClick={onClose}>
            শিফট বন্ধ করুন
          </Button>
        )}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat">
          <div className="stat-label">প্রাথমিক নগদ</div>
          <div className="stat-value"><Money paise={opening} /></div>
        </div>
        <div className="stat">
          <div className="stat-label">শিফটে নগদ এসেছে</div>
          <div className="stat-value" style={{ color: 'var(--c-success)' }}><Money paise={movedIn} /></div>
        </div>
        <div className="stat">
          <div className="stat-label">শিফটে নগদ গেছে</div>
          <div className="stat-value" style={{ color: 'var(--c-danger)' }}><Money paise={movedOut} /></div>
        </div>
        <div className="stat" style={{ borderColor: 'var(--c-primary)' }}>
          <div className="stat-label">হিসাবে হওয়া উচিত</div>
          <div className="stat-value" style={{ color: 'var(--c-primary)' }}><Money paise={expected} /></div>
          <div className="stat-sub">বন্ধের সময় হাতে নগদ এর সাথে মিলবে</div>
        </div>
      </div>
    </div>
  );
}

function OpenModal({ token, onClose, onDone }: { token: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [opening, setOpening] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await api.shift.open(token, { openingCashPaise: toPaise(opening), note: note.trim() || undefined, idempotencyKey: idemKey() });
      toast('success', 'শিফট খোলা হয়েছে', `রেফারেন্স: ${res.referenceNo}`);
      onDone();
    } catch (e) {
      toast('error', 'শিফট খোলা যায়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="শিফট খুলুন"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} onClick={save}>শিফট খুলুন</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)', lineHeight: 1.6 }}>
          টেনে-গুনে ক্যাশ ডেসকে যে নগদ আছে তা লিখুন। পরের বিক্রয়/খরচ সব হিসাবে যোগ-বিয়োগ হবে।
        </p>
        <Field label="প্রাথমিক নগদ (৳) *">
          <TextInput inputMode="decimal" className="input-money" value={opening || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setOpening(Number.isFinite(v) ? v : 0); }} autoFocus />
        </Field>
        <Field label="নোট">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="ঐচ্ছিক" />
        </Field>
      </div>
    </Modal>
  );
}

function CloseModal({ token, shift, onClose, onDone }: { token: string; shift: Row; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [summary, setSummary] = useState<{ cashIn: number; cashOut: number } | null>(null);
  const [actual, setActual] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        const s = await api.shift.cashSummary(token, (shift.opened_at as number) ?? Date.now(), Date.now());
        setSummary(s);
        const expected = ((shift.opening_cash_paise as number) ?? 0) + s.cashIn - s.cashOut;
        setActual(fromPaise(expected));
      } catch (e) {
        toast('error', 'হিসাব আনা যায়নি', errMsg(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opening = (shift.opening_cash_paise as number) ?? 0;
  const expected = summary ? opening + summary.cashIn - summary.cashOut : 0;
  const actualPaise = actual === null ? 0 : toPaise(actual);
  const variance = actualPaise - expected;

  async function save() {
    if (actual === null) return;
    setBusy(true);
    try {
      const res = await api.shift.close(token, { shiftId: String(shift.id), actualCashPaise: actualPaise, note: note.trim() || undefined }, idemKey());
      toast(
        res.variancePaise === 0 ? 'success' : 'warn',
        'শিফট বন্ধ হয়েছে',
        `ফারাক: ${formatBdtBn(res.variancePaise)}`
      );
      onDone();
    } catch (e) {
      toast('error', 'শিফট বন্ধ করা যায়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="শিফট বন্ধ করুন"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={actual === null} onClick={save}>
            শিফট বন্ধ করুন
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="detail-cell"><div className="k">প্রাথমিক নগদ</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}><Money paise={opening} /></div></div>
          <div className="detail-cell"><div className="k">নেট নগদ চলাচল</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}>{summary ? formatBdtBn(summary.cashIn - summary.cashOut) : '…'}</div></div>
          <div className="detail-cell"><div className="k">হিসাবে হওয়া উচিত</div><div className="v" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-primary)' }}><Money paise={expected} /></div></div>
        </div>
        <Field label="হাতে থাকা নগদ (৳) * — টেনে-গুনে লিখুন">
          <TextInput
            inputMode="decimal"
            className="input-money"
            value={actual === null ? '' : String(actual)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setActual(Number.isFinite(v) ? v : null);
            }}
            autoFocus
          />
        </Field>
        {actual !== null && (
          <div
            className="detail-cell"
            style={{ background: variance === 0 ? 'var(--c-success-soft)' : 'var(--c-warn-soft)', borderColor: variance === 0 ? 'var(--c-success)' : 'var(--c-warn)' }}
          >
            <div className="k">ফারাক</div>
            <div className="v" style={{ color: variance === 0 ? 'var(--c-success)' : 'var(--c-warn)' }}>
              {formatBdtBn(variance)}
            </div>
          </div>
        )}
        <Field label="নোট">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="যেমন: ফারাকের কারণ" />
        </Field>
      </div>
    </Modal>
  );
}

function formatBdtBn(paise: number): string {
  const s = (paise / 100).toLocaleString('en-IN');
  const map: Record<string, string> = { '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪', '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯' };
  return `৳${s.replace(/\d/g, (d) => map[d])}`;
}

function ShiftHistory({ token }: { token: string }) {
  const { data } = useAsync(async () => await api.shift.list(token, { limit: 100 }), [token]);
  const rows = (data ?? []) as Row[];
  const cols: Col<Row>[] = [
    { key: 'reference_no', label: 'রেফারেন্স', render: (r) => <strong>{String(r.reference_no)}</strong> },
    { key: 'opened_at', label: 'খোলা', render: (r) => fmtDateTime((r.opened_at as number) ?? null) },
    { key: 'closed_at', label: 'বন্ধ', render: (r) => fmtDateTime((r.closed_at as number) ?? null) },
    { key: 'user_name', label: 'ক্যাশিয়ার', render: (r) => String(r.user_name ?? '—') },
    { key: 'opening_cash_paise', label: 'প্রাথমিক', align: 'right', render: (r) => <Money paise={(r.opening_cash_paise as number) ?? 0} /> },
    { key: 'expected_cash_paise', label: 'হিসাবমত', align: 'right', render: (r) => <Money paise={(r.expected_cash_paise as number) ?? 0} /> },
    { key: 'actual_cash_paise', label: 'হাতে', align: 'right', render: (r) => <Money paise={(r.actual_cash_paise as number) ?? 0} /> },
    {
      key: 'variance_paise', label: 'ফারাক', align: 'right', render: (r) => {
        const v = (r.variance_paise as number) ?? 0;
        if ((r.status as string) === 'open') return <span className="badge badge-blue">খোলা</span>;
        return v === 0 ? <span className="badge badge-green">মিলেছে</span> : <span className="badge badge-amber">{formatBdtBn(v)}</span>;
      }
    }
  ];
  return <DataTable cols={cols} rows={rows} emptyTitle="কোনো শিফটের রেকর্ড নেই" emptySub="শিফট খুলে-বন্ধ করলে ইতিহাস এখানে দেখা যাবে।" />;
}

function DailyClosing({ token }: { token: string }) {
  const { data, busy, reload } = useAsync(async () => (await api.shift.dailyClosing(token)) as Row, [token]);
  if (busy || !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <Button icon={<FileText size={15} />} onClick={reload}>রিফ্রেশ</Button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat"><div className="stat-label">আজকের বিক্রয় (নিট)</div><div className="stat-value"><Money paise={(data.netSales as number) ?? 0} /></div></div>
        <div className="stat"><div className="stat-label">COGS</div><div className="stat-value"><Money paise={(data.cogs as number) ?? 0} /></div></div>
        <div className="stat"><div className="stat-label">মূল লব্ধি</div><div className="stat-value" style={{ color: 'var(--c-success)' }}><Money paise={(data.grossProfit as number) ?? 0} /></div></div>
        <div className="stat"><div className="stat-label">আজকের খরচ</div><div className="stat-value" style={{ color: 'var(--c-warn)' }}><Money paise={(data.expenses as number) ?? 0} /></div></div>
      </div>
      <div style={{ height: 14 }} />
      <div className="stat" style={{ borderColor: 'var(--c-primary)' }}>
        <div className="stat-label">আজকের নিট লাভ</div>
        <div className="stat-value" style={{ color: 'var(--c-primary)' }}><Money paise={(data.netProfit as number) ?? 0} /></div>
        <div className="stat-sub">নিট বিক্রয় − COGS − খরচ</div>
      </div>
    </div>
  );
}
