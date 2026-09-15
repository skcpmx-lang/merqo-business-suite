/** Sales — ledger of all sales: view detail, void (with restock/reversal),
 *  process sales returns. */
import React, { useMemo, useState } from 'react';
import { ReceiptText, Search, Ban, PackageOpen, FileText } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, DataTable, type Col, Modal, Field, TextInput, Money, useToast, fmtDate, Bn, ConfirmDialog } from '../../ui';
 '@shared/money';
import { paymentMethodLabel } from '@shared/payments';

export function Sales() {
  const { user, can } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Row | null>(null);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const { data, busy, reload } = useAsync(
    async () =>
      await api.sales.query(token, { search: search || undefined, limit: 50, offset: page * 50 } as never),
    [token, search, page]
  );

  const rows = useMemo(() => (data?.rows ?? []) as Row[], [data]);

  const cols: Col<Row>[] = [
    { key: 'reference_no', label: 'রফারেন্স', render: (r) => <strong>{String(r.reference_no)}</strong> },
    { key: 'date', label: 'তারিখ', render: (r) => fmtDate((r.date as number) ?? null) },
    { key: 'customer_name', label: 'কাস্টমার', render: (r) => String(r.customer_name ?? 'সামান কাস্তমার') },
    { key: 'user_name', label: 'ক্যাশিয়ার', render: (r) => String(r.user_name ?? '—') },
    { key: 'total_paise', label: 'মোট', align: 'right', render: (r) => <strong><Money paise={(r.total_paise as number) ?? 0} /></strong> },
    {
      key: 'due_paise', label: 'বকেয়া', align: 'right', render: (r) => {
        const d = (r.due_paise as number) ?? 0;
        return d > 0 ? <span style={{ color: 'var(--c-danger)', fontWeight: 700 }}><Money paise={d} /></span> : <span style={{ color: 'var(--c-ink-3)' }}>—</span>;
      }
    },
    {
      key: 'status', label: 'স্ট্যাটাস', render: (r) => {
        const s = String(r.status ?? '');
        if (s === 'voided') return <span className="badge badge-red">বিলগা</span>;
        if (s === 'partially_refunded') return <span className="badge badge-amber">আংশিক ফেরত</span>;
        if (s === 'refunded') return <span className="badge badge-gray">ফেরত</span>;
        return <span className="badge badge-green">সম্পন্ন</span>;
      }
    }
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">বিক্রয়ের হিসাব</div>
          <div className="page-sub">মোট <Bn>{data?.total ?? 0}</Bn>টি বিল</div>
        </div>
        <div className="toolbar">
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--c-ink-3)' }} />
            <TextInput style={{ paddingLeft: 30 }} placeholder="রফারেন্স / কাস্টমার…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
        </div>
      </div>

      <DataTable
        cols={cols}
        rows={rows}
        onRow={(r) => setDetail(r)}
        emptyTitle="এখনো কোনো বিক্রয় নেই"
        emptySub="POS থেকে বিক্রয় করলে সব বিল এখানে দেখা যাবে।"
        emptyIcon={<ReceiptText size={20} />}
      />

      {(data?.total ?? 0) > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>পূর্বের</Button>
          <Button variant="outline" disabled={(page + 1) * 50 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>পরবর্তী</Button>
        </div>
      )}

      {detail && (
        <SaleDetailModal
          token={token}
          sale={detail}
          onClose={() => setDetail(null)}
          onChanged={reload}
          onVoid={() => {
            const s = detail;
            setDetail(null);
            setVoiding(s);
          }}
        />
      )}

      {voiding && (
        <ConfirmDialog
          title="বিল বাতিল (বিলগা) করবেন?"
          message={
            <>
              <p>বিল <strong>{String(voiding.reference_no)}</strong> — ৳{(((voiding.total_paise as number) ?? 0) / 100).toLocaleString('en-IN')}</p>
              <p style={{ marginTop: 8 }}>স্টক আবার যোগ হবে এবং সব হিসাব পূর্বাবস্থায় ফিরে যাবে। রেকর্ড থাকবে “বিলগা” অবস্থায়।</p>
              <div style={{ marginTop: 12 }}>
                <TextInput value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="কারণ (অবশ্যিক)" autoFocus />
              </div>
            </>
          }
          confirmLabel="বিলগা করুন"
          danger
          onConfirm={async () => {
            try {
              await api.sales.void(token, String(voiding.id), voidReason.trim() || 'কারণ উল্লেখ করা হয়নি', idemKey());
              setVoiding(null);
              setVoidReason('');
              reload();
              toast('success', 'বিল বাতিল হয়েছে');
            } catch (e) {
              toast('error', 'বাতিল করা যায়নি', errMsg(e));
            }
          }}
          onClose={() => {
            setVoiding(null);
            setVoidReason('');
          }}
        />
      )}
    </div>
  );
}

function SaleDetailModal({
  token,
  sale,
  onClose,
  onChanged,
  onVoid
}: {
  token: string;
  sale: Row;
  onClose: () => void;
  onChanged: () => void;
  onVoid: () => void;
}) {
  const { user, can } = useSession();
  const toast = useToast();
  const [returning, setReturning] = useState(false);
  const [retQty, setRetQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const items = (sale.items as Row[]) ?? [];
  const payments = (sale.payments as Row[]) ?? [];
  const active = (sale.status as string) !== 'voided';

  async function doReturn() {
    const sel = items
      .map((i) => ({ i, q: retQty[String(i.id)] ?? 0 }))
      .filter((x) => x.q > 0);
    if (sel.length === 0) {
      toast('warn', 'ফেরত করার পণ্য নির্বাচন করুন');
      return;
    }
    setBusy(true);
    try {
      await api.sales.createReturn(
        token,
        {
          saleId: String(sale.id),
          reason: reason.trim() || 'পণ্য ফেরত',
          items: sel.map((x) => ({ saleItemId: String(x.i.id), quantity: x.q, restock }))
        },
        idemKey()
      );
      toast('success', 'বিক্রয় ফেরত সম্পন্ন');
      onChanged();
      onClose();
    } catch (e) {
      toast('error', 'ফেরত হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`বিল ${String(sale.reference_no)}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {can('sales.return') && active && (
            <Button variant="outline" icon={<PackageOpen size={15} />} onClick={() => setReturning((r) => !r)} style={{ marginRight: 'auto' }}>
              পণ্য ফেরত
            </Button>
          )}
          {can('sales.void') && active && (
            <Button variant="danger-soft" icon={<Ban size={15} />} onClick={onVoid}>
              বাতিল (বিলগা)
            </Button>
          )}
          <Button
            variant="outline"
            icon={<FileText size={15} />}
            onClick={async () => {
              try {
                const html = await api.print.receiptHtml(token, String(sale.reference_no), '80mm');
                const path = await api.print.savePdf({ html, defaultFileName: `${String(sale.reference_no)}.pdf` });
                if (path) toast('success', 'PDF সংরক্ষিত', path);
              } catch (e) {
                toast('error', 'PDF তৈরি হয়নি', errMsg(e));
              }
            }}
          >
            রসিদ PDF
          </Button>
          <Button variant="primary" onClick={onClose}>বন্ধ করুন</Button>
        </>
      }
    >
      <div className="detail-grid">
        <div className="detail-cell"><div className="k">তারিখ</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}>{fmtDate((sale.date as number) ?? null)}</div></div>
        <div className="detail-cell"><div className="k">কাস্টমার</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}>{String(sale.customer_name ?? 'সামান কাস্তমার')}</div></div>
        <div className="detail-cell"><div className="k">মোট</div><div className="v"><Money paise={(sale.total_paise as number) ?? 0} /></div></div>
        <div className="detail-cell"><div className="k">বকেয়া</div><div className="v" style={{ color: (sale.due_paise as number) ? 'var(--c-danger)' : 'var(--c-success)' }}><Money paise={(sale.due_paise as number) ?? 0} /></div></div>
      </div>

      <div className="table-wrap" style={{ borderRadius: 10 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>পণ্য</th>
              <th className="num">পরিমাণ</th>
              <th className="num">দাম</th>
              <th className="num">মোট</th>
              {returning && <th className="num">ফেরত</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={String(i.id)}>
                <td>{String(i.product_name_snapshot ?? i.product_name ?? '—')}</td>
                <td className="num"><Bn>{String(i.quantity)}</Bn></td>
                <td className="num"><Money paise={(i.unit_price_paise as number) ?? 0} /></td>
                <td className="num strong"><Money paise={(i.line_total_paise as number) ?? 0} /></td>
                {returning && (
                  <td className="num">
                    <TextInput
                      inputMode="numeric"
                      style={{ width: 70 }}
                      placeholder="০"
                      value={retQty[String(i.id)] || ''}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setRetQty((m) => ({ ...m, [String(i.id)]: Number.isFinite(v) ? Math.min(v, Number(i.quantity)) : 0 }));
                      }}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {returning && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            পণ্য আবার স্টকে যোগ করুন (রিস্টক)
          </label>
          <Field label="ফেরতের কারণ">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="যেমন: ব্যাল ভাঙা" />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="danger" loading={busy} onClick={doReturn}>ফেরত সম্পন্ন করুন</Button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--c-ink-2)', marginBottom: 6 }}>পেমেন্ট</div>
        {payments.map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', padding: '3px 0' }}>
            <span>{paymentMethodLabel(String(p.payment_method ?? ''))}</span>
            <Money paise={(p.amount_paise as number) ?? 0} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
