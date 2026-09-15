/** Purchases — create stock purchases with payments, view detail,
 *  process purchase returns. */
import React, { useMemo, useState } from 'react';
import { ShoppingBag, Plus, Search, X, PackageOpen } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, DataTable, type Col, Modal, Field, TextInput, SelectInput, Money, useToast, fmtDate, Bn, Empty } from '../../ui';
import { toPaise, fromPaise } from '@shared/money';
import { fromYMD } from '@shared/dates';
import { PAYMENT_METHODS, paymentMethodLabel } from '@shared/payments';

interface PLLine {
  productId: string;
  name: string;
  quantity: number;
  cost: number; // taka
  unitName: string;
  batchNo: string;
  expiryDate: string; // YYYY-MM-DD (ঐচ্ছিক)
}

interface PLPay {
  method: string;
  amount: number; // taka
}

export function Purchases() {
  const { user, can } = useSession();
  const token = user!.token;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);

  const { data, busy, reload } = useAsync(
    async () =>
      await api.purchases.query(token, { search: search || undefined, limit: 50, offset: page * 50 } as never),
    [token, search, page]
  );

  const rows = useMemo(() => (data?.rows ?? []) as Row[], [data]);

  const cols: Col<Row>[] = [
    { key: 'reference_no', label: 'রেফারেন্স', render: (r) => <strong>{String(r.reference_no)}</strong> },
    { key: 'date', label: 'তারিখ', render: (r) => fmtDate((r.date as number) ?? null) },
    { key: 'supplier_name', label: 'সাপ্লায়ার', render: (r) => String(r.supplier_name ?? '—') },
    { key: 'supplier_invoice_no', label: 'সাপ্লায়ারের ইনভয়েস', render: (r) => String(r.supplier_invoice_no ?? '—') },
    { key: 'total_paise', label: 'মোট', align: 'right', render: (r) => <strong><Money paise={(r.total_paise as number) ?? 0} /></strong> },
    {
      key: 'due_paise', label: 'বকেয়া', align: 'right', render: (r) => {
        const d = (r.due_paise as number) ?? 0;
        return d > 0 ? <span className="badge badge-red"><Money paise={d} /></span> : <span className="badge badge-green">পরিশোধিত</span>;
      }
    }
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">ক্রয়</div>
          <div className="page-sub">মোট <Bn>{data?.total ?? 0}</Bn>টি ক্রয়</div>
        </div>
        <div className="toolbar">
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--c-ink-3)' }} />
            <TextInput style={{ paddingLeft: 30 }} placeholder="রেফারেন্স / সাপ্লায়ার…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          {can('purchases.create') && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              নতুন ক্রয়
            </Button>
          )}
        </div>
      </div>

      <DataTable
        cols={cols}
        rows={rows}
        onRow={(r) => setDetail(r)}
        emptyTitle="এখনো কোনো ক্রয় নেই"
        emptySub="সাপ্লায়ারের কাছ থেকে পণ্য ক্রয় করলে এখানে দেখা যাবে।"
        emptyIcon={<ShoppingBag size={20} />}
      />

      {(data?.total ?? 0) > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>পূর্বের</Button>
          <Button variant="outline" disabled={(page + 1) * 50 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>পরবর্তী</Button>
        </div>
      )}

      {creating && <PurchaseFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {detail && <PurchaseDetailModal token={token} purchase={detail} onClose={() => setDetail(null)} onChanged={reload} />}
    </div>
  );
}

function PurchaseFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [products, setProducts] = useState<Row[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [lines, setLines] = useState<PLLine[]>([]);
  const [payments, setPayments] = useState<PLPay[]>([]);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    void (async () => {
      const [s, p] = await Promise.all([
        api.suppliers.list(token, {}),
        api.products.query(token, { limit: 500 })
      ]);
      setSuppliers((s.rows ?? []) as Row[]);
      setProducts((p.rows ?? []) as Row[]);
    })();
  }, [token]);

  const total = lines.reduce((s, l) => s + l.quantity * toPaise(l.cost), 0);
  const paid = payments.reduce((s, p) => s + toPaise(p.amount), 0);
  const due = Math.max(0, total - paid);

  function addLine() {
    const p = products[0];
    if (!p) return;
    setLines((ls) => [...ls, { productId: String(p.id), name: String(p.name), quantity: 1, cost: fromPaise((p.purchase_price_paise as number) ?? 0), unitName: String(p.unit_name ?? 'পিস'), batchNo: '', expiryDate: '' }]);
  }

  function setLine(i: number, patch: Partial<PLLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!supplierId || lines.length === 0) return;
    setBusy(true);
    try {
      const res = await api.purchases.create(token, {
        supplierId,
        supplierInvoiceNo: invoiceNo.trim() || undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCostPaise: toPaise(l.cost),
          batchNo: l.batchNo.trim() || undefined,
          expiryDate: l.expiryDate ? fromYMD(l.expiryDate) : undefined
        })),
        payments: payments.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amountPaise: toPaise(p.amount) })),
        idempotencyKey: idemKey()
      });
      toast('success', 'ক্রয় সম্পন্ন', `রেফারেন্স: ${res.referenceNo}`);
      onSaved();
    } catch (e) {
      toast('error', 'ক্রয় সম্পন্ন হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="নতুন ক্রয়"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <div style={{ marginRight: 'auto', fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)' }}>
            মোট <strong>৳{(total / 100).toLocaleString('en-IN')}</strong>
            {due > 0 && <span style={{ color: 'var(--c-danger)', marginLeft: 10 }}>বকেয়া: ৳{(due / 100).toLocaleString('en-IN')}</span>}
          </div>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={!supplierId || lines.length === 0} onClick={submit}>
            ক্রয় সম্পন্ন করুন
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <Field label="সাপ্লায়ার *">
          <SelectInput value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">নির্বাচন করুন</option>
            {suppliers.map((s) => (
              <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>
            ))}
          </SelectInput>
        </Field>
        <Field label="সাপ্লায়ারের ইনভয়েস নং">
          <TextInput value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="ঐচ্ছিক" />
        </Field>
      </div>

      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>পণ্য</th>
              <th style={{ width: 90 }}>পরিমাণ</th>
              <th style={{ width: 120 }}>খরচদাম (৳)</th>
              <th style={{ width: 110 }}>ব্যাচ নং</th>
              <th style={{ width: 140 }}>মেয়াদ (ঐচ্ছিক)</th>
              <th style={{ width: 110 }} className="num">লাইন মোট</th>
              <th style={{ width: 44 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr><td colSpan={7}><Empty title="কোনো পণ্য যোগ করা হয়নি" compact sub="নিচে “পণ্য যোগ করুন” চাপুন।" /></td></tr>
            )}
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <SelectInput value={l.productId} onChange={(e) => {
                    const p = products.find((x) => String(x.id) === e.target.value);
                    if (p) setLine(i, { productId: String(p.id), name: String(p.name), cost: fromPaise((p.purchase_price_paise as number) ?? 0), unitName: String(p.unit_name ?? 'পিস') });
                  }}>
                    {products.map((p) => (
                      <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>
                    ))}
                  </SelectInput>
                </td>
                <td>
                  <TextInput inputMode="decimal" value={l.quantity || ''} onChange={(e) => { const v = Number(e.target.value); setLine(i, { quantity: Number.isFinite(v) ? v : 0 }); }} />
                </td>
                <td>
                  <TextInput inputMode="decimal" className="input-money" value={l.cost || ''} onChange={(e) => { const v = Number(e.target.value); setLine(i, { cost: Number.isFinite(v) ? v : 0 }); }} />
                </td>
                <td>
                  <TextInput value={l.batchNo} onChange={(e) => setLine(i, { batchNo: e.target.value })} placeholder="ঐচ্ছিক" />
                </td>
                <td>
                  <TextInput type="date" value={l.expiryDate} onChange={(e) => setLine(i, { expiryDate: e.target.value })} />
                </td>
                <td className="num strong">৳{(((l.quantity * toPaise(l.cost)) / 100).toFixed(2)).replace(/\.00$/, '')}</td>
                <td>
                  <button className="modal-close" style={{ width: 26, height: 26 }} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="মুছুন">
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Button variant="outline" icon={<Plus size={15} />} onClick={addLine} disabled={products.length === 0}>
          পণ্য যোগ করুন
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        {PAYMENT_METHODS.filter((m) => m.key !== 'cheque').slice(0, 4).map((m) => {
          const p = payments.find((x) => x.method === m.key);
          return (
            <div className="field" key={m.key} style={{ flex: 1 }}>
              <label>{paymentMethodLabel(m.key)}</label>
              <TextInput
                inputMode="decimal"
                className="input-money"
                placeholder="০"
                value={p?.amount || ''}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const n = Number.isFinite(v) ? v : 0;
                  setPayments((ps) => {
                    const rest = ps.filter((x) => x.method !== m.key);
                    return n > 0 ? [...rest, { method: m.key, amount: n }] : rest;
                  });
                }}
              />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function PurchaseDetailModal({
  token,
  purchase,
  onClose,
  onChanged
}: {
  token: string;
  purchase: Row;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user, can } = useSession();
  const toast = useToast();
  const [returning, setReturning] = useState(false);
  const [retQty, setRetQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const items = (purchase.items as Row[]) ?? [];
  const payments = (purchase.payments as Row[]) ?? [];
  const returnable = (purchase.status as string) !== 'voided';

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
      await api.purchases.createReturn(
        token,
        {
          purchaseId: String(purchase.id),
          reason: reason.trim() || 'পণ্য ফেরত',
          items: sel.map((x) => ({ purchaseItemId: String(x.i.id), quantity: x.q }))
        },
        idemKey()
      );
      toast('success', 'ক্রয় ফেরত সম্পন্ন');
      setReturning(false);
      setRetQty({});
      onChanged();
      onClose();
    } catch (e) {
      toast('error', 'রিটার্ন হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`ক্রয় ${String(purchase.reference_no)}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {can('purchases.return') && returnable && (
            <Button variant="danger-soft" icon={<PackageOpen size={15} />} onClick={() => setReturning((r) => !r)} style={{ marginRight: 'auto' }}>
              পণ্য ফেরত
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>বন্ধ করুন</Button>
        </>
      }
    >
      <div className="detail-grid">
        <div className="detail-cell"><div className="k">তারিখ</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}>{fmtDate((purchase.date as number) ?? null)}</div></div>
        <div className="detail-cell"><div className="k">সাপ্লায়ার</div><div className="v" style={{ fontSize: 'var(--fs-md)' }}>{String(purchase.supplier_name ?? '—')}</div></div>
        <div className="detail-cell"><div className="k">মোট</div><div className="v"><Money paise={(purchase.total_paise as number) ?? 0} /></div></div>
        <div className="detail-cell"><div className="k">বকেয়া</div><div className="v" style={{ color: (purchase.due_paise as number) ? 'var(--c-danger)' : 'var(--c-success)' }}><Money paise={(purchase.due_paise as number) ?? 0} /></div></div>
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
                <td>{String(i.product_name ?? i.product_name_snapshot ?? '—')}</td>
                <td className="num"><Bn>{String(i.quantity)}</Bn></td>
                <td className="num"><Money paise={(i.unit_cost_paise as number) ?? 0} /></td>
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
          <Field label="ফেরতের কারণ">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="যেমন: ক্ষতিগ্রস্ত পণ্য" />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="danger" loading={busy} onClick={doReturn}>ফেরত সম্পন্ন করুন</Button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--c-ink-2)', marginBottom: 6 }}>পেমেন্ট</div>
        {payments.length === 0 ? (
          <div style={{ color: 'var(--c-ink-3)', fontSize: 'var(--fs-sm)' }}>সম্পূর্ণ বকেয়া হিসাবে</div>
        ) : (
          payments.map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', padding: '3px 0' }}>
              <span>{paymentMethodLabel(String(p.payment_method ?? ''))}</span>
              <Money paise={(p.amount_paise as number) ?? 0} />
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
