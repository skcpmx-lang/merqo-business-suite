/** POS — keyboard-first sale entry.
 *  - barcode scanner (HID) types into the search box, Enter → look up
 *  - unknown barcode → inline "add product or continue" flow
 *  - split payments, credit sales with due tracking, hold/resume carts
 *  - receipt preview after sale
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScanBarcode, Plus, Minus, Trash2, PauseCircle, PlayCircle,
  Banknote, Smartphone, Landmark, FileText, ReceiptText, User, X, PackagePlus, AlertTriangle
} from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row, SaleCreatedResult } from '@shared/ipc';
import { Button, Modal, TextInput, SelectInput, Empty, useToast, Money, fmtDate } from '../../ui';
import { PAYMENT_METHODS, paymentMethodLabel } from '@shared/payments';
import { toPaise, fromPaise } from '@shared/money';

interface CartLine {
  productId: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
  stock: number;
  unitName: string;
}

interface PayLine {
  method: string;
  amountTaka: number;
}

export function Pos() {
  const { user, can } = useSession();
  const toast = useToast();
  const token = user!.token;

  const { data: products, reload: reloadProducts } = useAsync(
    async () => (await api.products.query(token, { limit: 60 } as never)).rows as Row[],
    [token]
  );

  const { data: customers } = useAsync(async () => (await api.customers.list(token, {})).rows.slice(0, 200) as Row[], [token]);
  const { data: held } = useAsync(async () => (await api.sales.heldList(token)) as Row[], [token]);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [discountTaka, setDiscountTaka] = useState(0);
  const [payments, setPayments] = useState<PayLine[]>([]);
  const [activePay, setActivePay] = useState<string>('cash');
  const [busy, setBusy] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SaleCreatedResult | null>(null);
  const [heldModal, setHeldModal] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const priceOverrideAllowed = can('sales.priceOverride');
  const discountAllowed = can('sales.discount');

  const findable = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return (products ?? []).slice(0, 120);
    return (products ?? []).filter(
      (p) =>
        String(p.name ?? '').toLowerCase().includes(q) ||
        String(p.sku ?? '').toLowerCase().includes(q) ||
        String(p.primary_barcode ?? '').includes(q)
    );
  }, [search, products]);

  const addToCart = useCallback(
    (p: Row) => {
      const price = (p.selling_price_paise as number) || 0;
      const stock = (p.current_stock as number) ?? 0;
      setCart((c) => {
        const ex = c.find((l) => l.productId === p.id);
        if (ex) {
          if (ex.quantity + 1 > stock && !fromStockOverride()) {
            toast('warn', 'স্টক শেষ', `"${ex.name}"-এর আর স্টক নেই।`);
            return c;
          }
          return c.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
        }
        if (stock <= 0 && !fromStockOverride()) {
          toast('warn', 'স্টক শেষ', `"${String(p.name)}" এখন স্টকে নেই।`);
          return c;
        }
        return [
          ...c,
          {
            productId: String(p.id),
            name: String(p.name),
            quantity: 1,
            unitPricePaise: price,
            stock,
            unitName: String(p.unit_name ?? 'পিস')
          }
        ];
      });
    },
    [toast]
  );

  // setting flag (allow negative stock opt-in) checked once per session
  function fromStockOverride() {
    return (window as unknown as { __merqoAllowNegStock?: boolean }).__merqoAllowNegStock ?? false;
  }
  useEffect(() => {
    let alive = true;
    api.settings
      .get(token, 'financial', 'allow_negative_stock', false)
      .then((v) => {
        if (alive) (window as unknown as { __merqoAllowNegStock?: boolean }).__merqoAllowNegStock = !!v;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  function setQty(productId: string, qty: number) {
    setCart((c) =>
      c
        .map((l) => {
          if (l.productId !== productId) return l;
          if (qty <= 0) return { ...l, quantity: 0 };
          return { ...l, quantity: Math.min(qty, Math.max(l.stock, qty)) };
        })
        .filter((l) => l.quantity > 0)
    );
  }

  function setLinePrice(productId: string, taka: number) {
    setCart((c) => c.map((l) => (l.productId === productId ? { ...l, unitPricePaise: toPaise(taka) } : l)));
  }

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.unitPricePaise * l.quantity, 0), [cart]);
  const discountPaise = Math.min(toPaise(discountTaka), subtotal);
  const total = Math.max(0, subtotal - discountPaise);
  const paidTaka = payments.reduce((s, p) => s + (p.amountTaka || 0), 0);
  const paidPaise = toPaise(paidTaka);
  const duePaise = Math.max(0, total - paidPaise);
  const changePaise = customerId ? 0 : Math.max(0, paidPaise - total);

  async function onSearchEnter() {
    const code = search.trim();
    if (!code) return;
    const exact = (products ?? []).find((p) => String(p.primary_barcode ?? '') === code || String(p.sku ?? '').toLowerCase() === code.toLowerCase());
    if (exact) {
      addToCart(exact);
      setSearch('');
      return;
    }
    if (findable.length === 1) {
      addToCart(findable[0]);
      setSearch('');
      return;
    }
    // treat as barcode lookup in main (authoritative)
    try {
      const found = await api.products.barcode(token, code);
      if (found) {
        reloadProducts();
        return;
      }
      setUnknownBarcode(code);
    } catch (e) {
      toast('error', 'পণ্য খুঁজা যায়নি', errMsg(e));
    }
  }

  function addPayment(method: string, taka: number) {
    if (taka <= 0) return;
    setPayments((ps) => {
      const ex = ps.find((p) => p.method === method);
      if (ex) return ps.map((p) => (p.method === method ? { ...p, amountTaka: p.amountTaka + taka } : p));
      return [...ps, { method, amountTaka: taka }];
    });
  }

  function clearPayment(method: string) {
    setPayments((ps) => ps.filter((p) => p.method !== method));
  }

  async function completeSale() {
    if (cart.length === 0) return;
    setBusy(true);
    try {
      const res = await api.sales.create(token, {
        lines: cart.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          discountPaise: 0
        })),
        payments: payments.filter((p) => p.amountTaka > 0).map((p) => ({ method: p.method, amountPaise: toPaise(p.amountTaka) })),
        customerId: customerId || null,
        discountPaise,
        idempotencyKey: idemKey()
      });
      setCart([]);
      setPayments([]);
      setDiscountTaka(0);
      setCustomerId('');
      setReceipt(res);
      reloadProducts();
      toast('success', 'বিক্রয় সম্পন্ন', `রফারেন্স: ${res.referenceNo}`);
    } catch (e) {
      toast('error', 'বিক্রয় সম্পন্ন হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function holdCart() {
    if (cart.length === 0) return;
    try {
      await api.sales.hold(token, { items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPricePaise: l.unitPricePaise })), customerId: customerId || null, label: '' });
      setCart([]);
      setPayments([]);
      setDiscountTaka(0);
      toast('success', 'কার্ট হোল্ড হয়েছে');
    } catch (e) {
      toast('error', 'হোল্ড করা যায়নি', errMsg(e));
    }
  }

  async function resumeHeld(h: Row) {
    try {
      const c = await api.sales.heldResume(token, String(h.id));
      if (c) {
        const items = (c.items_json as string) ? JSON.parse(c.items_json as string) : (c.items as Row[]);
        const lines: CartLine[] = (Array.isArray(items) ? items : []).map((i) => ({
          productId: String(i.productId),
          name: String(i.product_name ?? i.name ?? ''),
          quantity: Number(i.quantity) || 1,
          unitPricePaise: Number(i.unit_price_paise ?? i.unitPricePaise ?? 0),
          stock: 1e9,
          unitName: String(i.unit_name ?? 'পিস')
        }));
        // resolve names from products
        const resolved = await Promise.all(
          lines.map(async (l) => {
            const p = (products ?? []).find((x) => String(x.id) === l.productId);
            return { ...l, name: l.name || (p ? String(p.name) : l.productId), stock: p ? Number(p.quantity) : 1e9, unitName: p ? String(p.unit_name ?? l.unitName) : l.unitName };
          })
        );
        setCart(resolved);
        if (c.customer_id) setCustomerId(String(c.customer_id));
      }
      setHeldModal(false);
    } catch (e) {
      toast('error', 'হোল্ড থেকে আনা যায়নি', errMsg(e));
    }
  }

  const cust = (customers ?? []).find((c) => String(c.id) === customerId);
  const custDue = cust ? ((cust.due_balance_paise as number) ?? 0) : 0;

  return (
    <div className="pos">
      <div className="pos-left">
        <div className="pos-searchbar">
          <div style={{ position: 'relative', flex: 1 }}>
            <ScanBarcode size={17} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--c-ink-3)' }} />
            <input
              ref={searchRef}
              className="input"
              style={{ paddingLeft: 38, height: 42, fontSize: 'var(--fs-lg)' }}
              placeholder="বারকোড স্ক্যান করুন অথবা নাম/SKU লিখে Enter দিন…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void onSearchEnter();
                }
              }}
              autoFocus
            />
          </div>
          <Button icon={<PlayCircle size={16} />} onClick={() => setHeldModal(true)} disabled={!held?.length}>
            হোল্ড ({held?.length ?? 0})
          </Button>
        </div>

        <div className="product-grid">
          {(findable ?? []).length === 0 ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <Empty
                title={search ? 'কোনো পণ্য পাওয়া যায়নি' : 'এখনো কোনো পণ্য নেই'}
                sub={search ? 'অন্য নাম বা বারকোড দিয়ে খুঁজে দেখুন।' : 'পণ্য মডিউল থেকে পণ্য যোগ করলে এখানে দেখা যাবে।'}
                icon={<PackagePlus size={20} />}
              />
            </div>
          ) : (
            findable.slice(0, 120).map((p) => {
              const out = ((p.current_stock as number) ?? 0) <= 0;
              return (
                <button
                  key={String(p.id)}
                  className={`pcard${out ? ' out' : ''}`}
                  onClick={() => addToCart(p)}
                  disabled={out}
                >
                  <div className="pn">{String(p.name)}</div>
                  <div className="pp">৳{(((p.selling_price_paise as number) ?? 0) / 100).toLocaleString('en-IN')}</div>
                  <div className="ps">
                    <span>{String(p.unit_name ?? '')}</span>
                    <span>স্টক: {toBangla(p.current_stock)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="pos-right">
        <div className="cart-panel" style={{ flex: 1 }}>
          <div className="cart-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ReceiptText size={16} style={{ color: 'var(--c-primary)' }} />
              <strong>কার্ট</strong>
              <span style={{ color: 'var(--c-ink-3)', fontSize: 'var(--fs-sm)' }}>({cart.length} আইটেম)</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant="ghost" icon={<PauseCircle size={14} />} onClick={holdCart} disabled={!cart.length}>
                হোল্ড
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => { setCart([]); setPayments([]); setDiscountTaka(0); }} disabled={!cart.length}>
                খালি
              </Button>
            </div>
          </div>

          <div className="cart-lines">
            {cart.length === 0 ? (
              <Empty title="কার্ট খালি" sub="বারকোড স্ক্যান করুন বা বাম পাশের পণ্যে ক্লিক করুন।" compact />
            ) : (
              cart.map((l) => (
                <div key={l.productId} className="cart-line">
                  <div className="nm" title={l.name}>
                    {l.name}
                    {priceOverrideAllowed && (
                      <input
                        className="input"
                        style={{ width: 74, height: 26, fontSize: 'var(--fs-xs)', marginTop: 3, padding: '0 8px' }}
                        defaultValue={fromPaise(l.unitPricePaise)}
                        key={l.productId + '-' + l.unitPricePaise}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v >= 0 && toPaise(v) !== l.unitPricePaise) setLinePrice(l.productId, v);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        title="দাম পরিবর্তন"
                      />
                    )}
                  </div>
                  <div className="qty-ctl">
                    <button onClick={() => setQty(l.productId, l.quantity - 1)} aria-label="কমান">
                      <Minus size={12} />
                    </button>
                    <span className="q">{toBangla(l.quantity)}</span>
                    <button onClick={() => setQty(l.productId, l.quantity + 1)} aria-label="বাড়ান">
                      <Plus size={12} />
                    </button>
                  </div>
                  <div className="lt">৳{(((l.unitPricePaise * l.quantity) / 100).toLocaleString('en-IN'))}</div>
                  <button className="modal-close" style={{ width: 24, height: 24 }} onClick={() => setQty(l.productId, 0)} aria-label="মুছুন">
                    <X size={13} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="pay-methods">
            {PAYMENT_METHODS.filter((m) => m.key !== 'cheque').map((m) => {
              const amt = payments.find((p) => p.method === m.key)?.amountTaka ?? 0;
              return (
                <button
                  key={m.key}
                  className={`pay-btn${activePay === m.key ? ' selected' : ''}`}
                  onClick={() => {
                    setActivePay(m.key);
                    const payInput = document.getElementById(`pay-${m.key}`) as HTMLInputElement | null;
                    payInput?.focus();
                  }}
                >
                  {m.key === 'cash' ? <Banknote size={15} /> : m.key === 'bank' ? <Landmark size={15} /> : <Smartphone size={15} />}
                  {paymentMethodLabel(m.key)}
                  {amt > 0 && <span className="amt">৳{amt.toLocaleString('en-IN')}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ padding: '8px 14px 0', display: 'flex', gap: 8 }}>
            <TextInput
              id={`pay-${activePay}`}
              className="input-money"
              placeholder={`${paymentMethodLabel(activePay)}-এর পেমেন্ট (৳)`}
              inputMode="decimal"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v) && v > 0) {
                    addPayment(activePay, v);
                    e.currentTarget.value = '';
                  }
                }
              }}
            />
            <Button
              variant="outline"
              icon={<Plus size={15} />}
              onClick={() => {
                const el = document.getElementById(`pay-${activePay}`) as HTMLInputElement | null;
                const v = Number(el?.value ?? 0);
                if (Number.isFinite(v) && v > 0) {
                  addPayment(activePay, v);
                  if (el) el.value = '';
                }
              }}
            >
              যোগ
            </Button>
          </div>

          <div className="totals">
            <div className="row">
              <span>সাবটোটাল</span>
              <Money paise={subtotal} />
            </div>
            {discountAllowed && (
              <div className="row" style={{ alignItems: 'center' }}>
                <span>সামগ্রিক ছাড় (৳)</span>
                <input
                  className="input input-money"
                  style={{ width: 90, height: 28 }}
                  inputMode="decimal"
                  value={discountTaka || ''}
                  placeholder="০"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDiscountTaka(Number.isFinite(v) ? Math.max(0, v) : 0);
                  }}
                />
              </div>
            )}
            <div className="row">
              <span>সর্বমোট</span>
              <Money paise={total} />
            </div>
            <div className="row">
              <span>প্রদত্ত</span>
              <Money paise={paidPaise} />
            </div>
            {customerId && (
              <div className="row" style={{ color: 'var(--c-warn)', fontWeight: 700 }}>
                <span>বকেয়া হবে</span>
                <Money paise={duePaise} />
              </div>
            )}
            {changePaise > 0 && (
              <div className="row" style={{ color: 'var(--c-success)', fontWeight: 700 }}>
                <span>ফেরত</span>
                <Money paise={changePaise} />
              </div>
            )}
            <div className="row big" style={{ marginTop: 6 }}>
              <span>বাকি (আপনার)</span>
              <span style={{ color: duePaise > 0 ? 'var(--c-danger)' : 'var(--c-success)' }}>৳{(duePaise / 100).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div style={{ padding: '0 14px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <User size={15} style={{ color: 'var(--c-ink-3)' }} />
              <SelectInput value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ height: 32, fontSize: 'var(--fs-sm)' }}>
                <option value="">সামান কাস্টমার (নগদ)</option>
                {(customers ?? []).map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {String(c.name)}
                    {c.due_balance_paise ? ` (বকেয়া ৳${(((c.due_balance_paise as number) ?? 0) / 100).toLocaleString('en-IN')})` : ''}
                  </option>
                ))}
              </SelectInput>
            </div>
            {cust && custDue > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--c-warn-soft)', color: 'var(--c-warn)', borderRadius: 8, padding: '6px 10px', fontSize: 'var(--fs-xs)', fontWeight: 600, marginBottom: 8 }}>
                <AlertTriangle size={13} /> পূর্বের বকেয়া: ৳{(custDue / 100).toLocaleString('en-IN')}
              </div>
            )}
          </div>

          <div className="pay-actions">
            <Button
              variant="primary"
              size="lg"
              icon={<Banknote size={17} />}
              loading={busy}
              disabled={cart.length === 0 || (duePaise > 0 && !customerId) || (paidPaise > total + 0.5 && !customerId)}
              onClick={() => void completeSale()}
            >
              বিক্রয় সম্পন্ন (Enter)
            </Button>
          </div>
        </div>
      </div>

      {unknownBarcode && (
        <UnknownBarcodeModal
          code={unknownBarcode}
          onClose={() => {
            setUnknownBarcode(null);
            setSearch('');
            searchRef.current?.focus();
          }}
          onCreated={(p: Row) => {
            setUnknownBarcode(null);
            setSearch('');
            reloadProducts();
            addToCart(p);
            searchRef.current?.focus();
          }}
        />
      )}

      {heldModal && (
        <Modal title="হোল্ড করা কার্ট" onClose={() => setHeldModal(false)} size="lg">
          {(held ?? []).length === 0 ? (
            <Empty title="কোনো হোল্ড নেই" compact />
          ) : (
            (held ?? []).map((h) => (
              <div key={String(h.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 4px', borderBottom: '1px dashed var(--c-border)' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>
                    {String(h.label) || 'কার্ট'} — {fmtDate((h.created_at as number) ?? null)}
                  </div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>{String(h.user_name ?? '')}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button size="sm" variant="primary" icon={<PlayCircle size={13} />} onClick={() => void resumeHeld(h)}>
                    চালিয়ে যান
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    onClick={async () => {
                      try {
                        await api.sales.heldCancel(token, String(h.id));
                        setHeldModal(false);
                        const nh = await api.sales.heldList(token);
                        // refresh held via reload of the page state
                        window.dispatchEvent(new CustomEvent('merqo:reload-held'));
                        void nh;
                      } catch (e) {
                        toast('error', 'মুছে ফেলা যায়নি', errMsg(e));
                      }
                    }}
                  >
                    মুছুন
                  </Button>
                </div>
              </div>
            ))
          )}
        </Modal>
      )}

      {receipt && (
        <ReceiptPreviewModal
          token={token}
          sale={receipt}
          onClose={() => {
            setReceipt(null);
            searchRef.current?.focus();
          }}
          onNewSale={() => {
            setReceipt(null);
            searchRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function toBangla(n: unknown): string {
  const s = String(n ?? 0);
  const map: Record<string, string> = { '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪', '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯' };
  return s.replace(/\d/g, (d) => map[d]);
}

export function UnknownBarcodeModal({
  code,
  onClose,
  onCreated
}: {
  code: string;
  onClose: () => void;
  onCreated: (p: Row) => void;
}) {
  const { user, can } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [name, setName] = useState('');
  const [priceTaka, setPriceTaka] = useState(0);
  const [costTaka, setCostTaka] = useState(0);
  const [busy, setBusy] = useState(false);
  const canCreate = can('products.create');
  const { data: units } = useAsync(async () => (await api.master.units.list(token)) as Row[], [token]);

  async function create() {
    if (!name.trim() || priceTaka <= 0) return;
    setBusy(true);
    try {
      const unitId = (units?.[0] ?? { id: '' }).id as string;
      const id = await api.products.create(
        token,
        {
          name: name.trim(),
          unitId,
          sellingPricePaise: toPaise(priceTaka),
          purchasePricePaise: toPaise(costTaka),
          barcodes: [code],
          openingStock: 0
        },
        idemKey()
      );
      const p = (await api.products.get(token, id)) as Row;
      onCreated(p);
      toast('success', 'নতুন পণ্য যোগ হয়েছে', name.trim());
    } catch (e) {
      toast('error', 'পণ্য তৈরি হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="নতুন বারকোড"
      onClose={onClose}
      footer={
        canCreate ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              বাতিল
            </Button>
            <Button variant="primary" loading={busy} disabled={!name.trim() || priceTaka <= 0} onClick={create}>
              পণ্য তৈরি করে যোগ করুন
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            বন্ধ করুন
          </Button>
        )
      }
    >
      <p style={{ color: 'var(--c-ink-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, marginBottom: 14 }}>
        বারকোড <strong>{code}</strong> কোনো পণ্যের সাথে মেলেনি।
        {canCreate ? ' নতুন পণ্য হিসেবে তৈরি করতে পারেন।' : ' (পণ্য তৈরির অনুমতি নেই)'}
      </p>
      {canCreate && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TextInput placeholder="পণ্যের নাম *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>ভেদাম (৳) *</label>
              <input className="input input-money" inputMode="decimal" value={priceTaka || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setPriceTaka(Number.isFinite(v) ? v : 0); }} />
            </div>
            <div className="field">
              <label>খরচদাম (৳)</label>
              <input className="input input-money" inputMode="decimal" value={costTaka || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); setCostTaka(Number.isFinite(v) ? v : 0); }} />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ReceiptPreviewModal({
  token,
  sale,
  onClose,
  onNewSale
}: {
  token: string;
  sale: SaleCreatedResult;
  onClose: () => void;
  onNewSale: () => void;
}) {
  const toast = useToast();
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    api.print
      .receiptHtml(token, sale.referenceNo, '80mm')
      .then(setHtml)
      .catch((e) => toast('error', 'রসিদ তৈরি করা যায়নি', errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.referenceNo]);

  return (
    <Modal
      title="রসিদ"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button
            variant="outline"
            icon={<FileText size={15} />}
            onClick={async () => {
              if (!html) return;
              try {
                const path = await api.print.savePdf({ html, defaultFileName: `${sale.referenceNo}.pdf` });
                if (path) toast('success', 'PDF সংরক্ষিত', path);
              } catch (e) {
                toast('error', 'PDF তৈরি হয়নি', errMsg(e));
              }
            }}
          >
            PDF সংরক্ষণ
          </Button>
          <Button variant="primary" onClick={onNewSale}>
            নতুন বিক্রয়
          </Button>
        </>
      }
    >
      {html ? (
        <iframe className="receipt-frame" style={{ height: 420, border: '1px solid var(--c-border)', borderRadius: 10 }} srcDoc={html} title="রসিদ প্রিভিউ" />
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="spinner" />
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)', display: 'flex', justifyContent: 'space-between' }}>
        <span>
          রফারেন্স: <strong>{sale.referenceNo}</strong> — ৳{(sale.totalPaise / 100).toLocaleString('en-IN')}
        </span>
        {sale.changePaise > 0 && <span>ফেরত: ৳{(sale.changePaise / 100).toLocaleString('en-IN')}</span>}
        {sale.duePaise > 0 && <span style={{ color: 'var(--c-danger)' }}>বকেয়া: ৳{(sale.duePaise / 100).toLocaleString('en-IN')}</span>}
      </div>
    </Modal>
  );
}
