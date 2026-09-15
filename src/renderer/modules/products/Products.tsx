/** Products — master data with barcodes, categories, brands, price audit. */
import React, { useMemo, useState } from 'react';
import {
  Package, Plus, Search, Pencil, Trash2, Tag, History, AlertTriangle, Boxes
} from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, DataTable, type Col, Modal, Field, TextInput, SelectInput, Money, useToast, Empty, ConfirmDialog, fmtDate, Bn } from '../../ui';
import { toPaise, fromPaise } from '@shared/money';

interface ProductForm {
  name: string;
  sku: string;
  categoryId: string;
  brandId: string;
  unitId: string;
  cost: number;
  price: number;
  wholesale: number;
  minPrice: number;
  promotional: number;
  reorder: number;
  barcode: string;
  extraBarcodes: string;
  openingStock: number;
  openingCost: number;
  notes: string;
}

const emptyForm: ProductForm = {
  name: '', sku: '', categoryId: '', brandId: '', unitId: '',
  cost: 0, price: 0, wholesale: 0, minPrice: 0, promotional: 0,
  reorder: 0, barcode: '', extraBarcodes: '', openingStock: 0, openingCost: 0, notes: ''
};

export function Products() {
  const { user, can } = useSession();
  const toast = useToast();
  const token = user!.token;
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row | null>(null);

  const { data: cats } = useAsync(async () => (await api.master.categories.list(token)) as Row[], [token]);
  const { data: brands } = useAsync(async () => (await api.master.brands.list(token)) as Row[], [token]);
  const { data: units } = useAsync(async () => (await api.master.units.list(token)) as Row[], [token]);

  const limit = 50;
  const { data, busy, reload, setData } = useAsync(
    async () => await api.products.query(token, { search: search || undefined, categoryId: categoryId || undefined, limit, offset: page * limit }),
    [token, search, categoryId, page]
  );

  const rows = useMemo(() => (data?.rows ?? []) as Row[], [data]);

  const cols: Col<Row>[] = [
    {
      key: 'name', label: 'পণ্য', render: (r) => (
        <div>
          <div style={{ fontWeight: 700 }}>{String(r.name)}</div>
          {r.sku ? <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>{String(r.sku)}</div> : null}
        </div>
      )
    },
    { key: 'category_name', label: 'ক্যাটাগরি', render: (r) => String(r.category_name ?? '—') },
    { key: 'primary_barcode', label: 'বারকোড', render: (r) => <span className="money">{String(r.primary_barcode ?? '—')}</span> },
    {
      key: 'selling_price_paise', label: 'বিক্রয় মূল্য', align: 'right', render: (r) => (
        <span style={{ fontWeight: 700 }}><Money paise={(r.selling_price_paise as number) ?? 0} /></span>
      )
    },
    ...(can('stock.viewCost') ? [{
      key: 'cost', label: 'খরচদাম', align: 'right' as const, render: (r: Row) => <Money paise={(r.avg_cost_paise as number) ?? (r.purchase_price_paise as number) ?? 0} />
    }] : []),
    {
      key: 'current_stock', label: 'স্টক', align: 'right', render: (r) => {
        const q = (r.current_stock as number) ?? 0;
        const re = (r.reorder_level as number) ?? 0;
        if (q <= 0) return <span className="badge badge-red">শেষ</span>;
        if (re > 0 && q <= re) return <span className="badge badge-amber"><Bn>{q}</Bn> (কম)</span>;
        return <Bn>{q}</Bn>;
      }
    },
    {
      key: 'actions', label: '', align: 'right', render: (r) => (
        <div className="tbl-row-actions" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<History size={13} />} title="দামের ইতিহাস" onClick={() => setHistory(r)}>
            ইতিহাস
          </Button>
          {can('products.edit') && (
            <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(r)}>
              সম্পাদনা
            </Button>
          )}
          {can('products.delete') && (
            <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setDeleting(r)}>
              মুছুন
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
          <div className="page-title">পণ্য</div>
          <div className="page-sub">মোট <Bn>{data?.total ?? 0}</Bn>টি পণ্য</div>
        </div>
        <div className="toolbar">
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--c-ink-3)' }} />
            <TextInput style={{ paddingLeft: 30 }} placeholder="নাম / SKU / বারকোড…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          <SelectInput value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(0); }} style={{ width: 160 }}>
            <option value="">সব ক্যাটাগরি</option>
            {(cats ?? []).map((c) => (
              <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>
            ))}
          </SelectInput>
          <SelectInput value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} style={{ width: 130 }}>
            <option value="">সব স্টক</option>
            <option value="low">কম স্টক</option>
            <option value="out">শেষ স্টক</option>
          </SelectInput>
          {can('products.create') && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
              নতুন পণ্য
            </Button>
          )}
        </div>
      </div>

      <DataTable
        cols={cols}
        rows={rows}
        onRow={(r) => (can('products.edit') ? setEditing(r) : undefined)}
        emptyTitle="এখনো কোনো পণ্য নেই"
        emptySub="“নতুন পণ্য” চেপে প্রথম পণ্য যোগ করুন — নাম, দাম, বারকোড ও স্টক।"
        emptyIcon={<Package size={20} />}
      />

      {data && (data.total ?? 0) > limit && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>পূর্বের</Button>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)', alignSelf: 'center' }}>পাতা <Bn>{page + 1}</Bn></span>
          <Button variant="outline" disabled={(page + 1) * limit >= (data.total ?? 0)} onClick={() => setPage((p) => p + 1)}>পরবর্তী</Button>
        </div>
      )}

      {editing && (
        <ProductFormModal
          product={editing === 'new' ? null : editing}
          units={units ?? []}
          cats={cats ?? []}
          brands={brands ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="পণ্য মুছে ফেলবেন?"
          message={<>“<strong>{String(deleting.name)}</strong>”-কে লুকানো হবে (মুছে ফেলা)। পুরনো বিক্রয়-ক্রয়ের রেকর্ড অক্ষত থাকবে।</>}
          confirmLabel="মুছে ফেলুন"
          danger
          onConfirm={async () => {
            try {
              await api.products.delete(token, String(deleting.id), idemKey());
              setDeleting(null);
              reload();
              toast('success', 'পণ্য মুছে ফেলা হয়েছে');
            } catch (e) {
              toast('error', 'মুছে ফেলা যায়নি', errMsg(e));
            }
          }}
          onClose={() => setDeleting(null)}
        />
      )}

      {history && <PriceHistoryModal token={token} product={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function ProductFormModal({
  product,
  units,
  cats,
  brands,
  onClose,
  onSaved
}: {
  product: Row | null;
  units: Row[];
  cats: Row[];
  brands: Row[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user, can } = useSession();
  const toast = useToast();
  const token = user!.token;
  const isEdit = !!product;
  const [f, setF] = useState<ProductForm>(() => {
    if (!product) return { ...emptyForm, unitId: units[0] ? String(units[0].id) : '' };
    return {
      name: String(product.name ?? ''),
      sku: String(product.sku ?? ''),
      categoryId: String(product.category_id ?? ''),
      brandId: String(product.brand_id ?? ''),
      unitId: String(product.unit_id ?? ''),
      cost: fromPaise((product.purchase_price_paise as number) ?? 0),
      price: fromPaise((product.selling_price_paise as number) ?? 0),
      wholesale: fromPaise((product.wholesale_price_paise as number) ?? 0),
      minPrice: fromPaise((product.min_selling_price_paise as number) ?? 0),
      promotional: fromPaise((product.promotional_price_paise as number) ?? 0),
      reorder: Number(product.reorder_level ?? 0),
      barcode: String(product.primary_barcode ?? ''),
      extraBarcodes: '',
      openingStock: 0,
      openingCost: 0,
      notes: String(product.notes ?? '')
    };
  });
  const [busy, setBusy] = useState(false);
  const [priceReason, setPriceReason] = useState('');

  const priceChanged =
    isEdit &&
    (f.price !== fromPaise((product!.selling_price_paise as number) ?? 0) ||
      f.cost !== fromPaise((product!.purchase_price_paise as number) ?? 0) ||
      f.wholesale !== fromPaise((product!.wholesale_price_paise as number) ?? 0));

  const set = (patch: Partial<ProductForm>) => setF((x) => ({ ...x, ...patch }));

  async function save() {
    if (!f.name.trim()) {
      toast('warn', 'পণ্যের নাম দিন');
      return;
    }
    setBusy(true);
    try {
      const barcodes = [f.barcode, ...f.extraBarcodes.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)].filter(Boolean);
      if (isEdit) {
        const patch: Record<string, unknown> = {
          name: f.name.trim(), sku: f.sku.trim() || undefined,
          categoryId: f.categoryId || null, brandId: f.brandId || null,
          unitId: f.unitId,
          purchasePricePaise: toPaise(f.cost),
          sellingPricePaise: toPaise(f.price),
          wholesalePricePaise: toPaise(f.wholesale),
          minSellingPricePaise: toPaise(f.minPrice),
          promotionalPricePaise: f.promotional > 0 ? toPaise(f.promotional) : null,
          reorderLevel: f.reorder,
          notes: f.notes
        };
        if (barcodes.length) patch.newBarcodes = barcodes;
        if (priceChanged && priceReason.trim().length < 3) {
          toast('warn', 'দামের পরিবর্তনের কারণ লিখুন', 'দামের প্রতিটি পরিবর্তন অডিট লগে থাকে।');
          setBusy(false);
          return;
        }
        await api.products.update(token, { id: String(product!.id), patch, priceChangeReason: priceChanged ? priceReason.trim() : undefined }, idemKey());
        toast('success', 'পণ্য হালনাগাদ হয়েছে', f.name);
      } else {
        const id = await api.products.create(
          token,
          {
            name: f.name.trim(),
            sku: f.sku.trim() || undefined,
            categoryId: f.categoryId || null,
            brandId: f.brandId || null,
            unitId: f.unitId,
            purchasePricePaise: toPaise(f.cost),
            sellingPricePaise: toPaise(f.price),
            wholesalePricePaise: toPaise(f.wholesale),
            minSellingPricePaise: toPaise(f.minPrice),
            promotionalPricePaise: f.promotional > 0 ? toPaise(f.promotional) : null,
            reorderLevel: f.reorder,
            notes: f.notes,
            barcodes: barcodes.length ? barcodes : undefined,
            openingStock: f.openingStock,
            openingCostPaise: toPaise(f.openingCost || f.cost)
          },
          idemKey()
        );
        void id;
        toast('success', 'পণ্য তৈরি হয়েছে', f.name);
      }
      onSaved();
    } catch (e) {
      toast('error', isEdit ? 'হালনাগাদ হয়নি' : 'পণ্য তৈরি হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isEdit ? 'পণ্য সম্পাদনা' : 'নতুন পণ্য'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={!f.name.trim() || !f.unitId || f.price <= 0} onClick={save}>
            {isEdit ? 'সংরক্ষণ করুন' : 'তৈরি করুন'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <Field label="পণ্যের নাম *">
            <TextInput value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus placeholder="যেমন: চিপস (৩০ পয়সা)" />
          </Field>
          <Field label="SKU">
            <TextInput value={f.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="যেমন: CHIP-30" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <Field label="ক্যাটাগরি">
            <SelectInput value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">—</option>
              {cats.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>
              ))}
            </SelectInput>
          </Field>
          <Field label="ব্র্যান্ড">
            <SelectInput value={f.brandId} onChange={(e) => set({ brandId: e.target.value })}>
              <option value="">—</option>
              {brands.map((b) => (
                <option key={String(b.id)} value={String(b.id)}>{String(b.name)}</option>
              ))}
            </SelectInput>
          </Field>
          <Field label="একক *">
            <SelectInput value={f.unitId} onChange={(e) => set({ unitId: e.target.value })}>
              {units.map((u) => (
                <option key={String(u.id)} value={String(u.id)}>{String(u.name)}</option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Field label="খরচদাম (৳)">
            <TextInput type="text" inputMode="decimal" className="input-money" value={f.cost || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); set({ cost: Number.isFinite(v) ? v : 0 }); }} />
          </Field>
          <Field label="বিক্রয় মূল্য (৳) *">
            <TextInput type="text" inputMode="decimal" className="input-money" value={f.price || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); set({ price: Number.isFinite(v) ? v : 0 }); }} />
          </Field>
          <Field label="পাইকারি (৳)">
            <TextInput type="text" inputMode="decimal" className="input-money" value={f.wholesale || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); set({ wholesale: Number.isFinite(v) ? v : 0 }); }} />
          </Field>
          <Field label="সর্বনিম্ন দাম (৳)" hint="এর নিচে সেললে সতর্কতা">
            <TextInput type="text" inputMode="decimal" className="input-money" value={f.minPrice || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); set({ minPrice: Number.isFinite(v) ? v : 0 }); }} />
          </Field>
        </div>
        {isEdit && priceChanged && (
          <Field label="দাম পরিবর্তনের কারণ *" hint="এই তথ্য দামের ইতিহাসে সংরক্ষিত হবে">
            <TextInput value={priceReason} onChange={(e) => setPriceReason(e.target.value)} placeholder="যেমন: সাপ্লায়ারের নতুন মূল্য" />
          </Field>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <Field label="বারকোড (প্রাইমারি)">
            <TextInput value={f.barcode} onChange={(e) => set({ barcode: e.target.value })} placeholder="স্ক্যান বা লিখুন" />
          </Field>
          <Field label="অন্যান্য বারকোড" hint="কমা দিয়ে আলাদা">
            <TextInput value={f.extraBarcodes} onChange={(e) => set({ extraBarcodes: e.target.value })} placeholder="৮৯০..., ৮৯১..." />
          </Field>
          <Field label="পুনরায় অর্ডার সীমা" hint="এই মাত্রার নিচে গেলে সতর্কতা">
            <TextInput inputMode="numeric" value={f.reorder || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); set({ reorder: Number.isFinite(v) ? v : 0 }); }} />
          </Field>
        </div>
        {!isEdit && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="প্রাথমিক স্টক" hint="খালি/০ হলে পরে ক্রয় দিয়ে স্টক আসবে">
              <TextInput inputMode="decimal" value={f.openingStock || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); set({ openingStock: Number.isFinite(v) ? v : 0 }); }} />
            </Field>
            <Field label="প্রাথমিক স্টকের খরচ (৳)" hint="খালি থাকলে খরচদাম ধরা হবে">
              <TextInput inputMode="decimal" className="input-money" value={f.openingCost || ''} placeholder="০" onChange={(e) => { const v = Number(e.target.value); set({ openingCost: Number.isFinite(v) ? v : 0 }); }} />
            </Field>
          </div>
        )}
        <Field label="নোট">
          <TextInput value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="ঐচ্ছিক" />
        </Field>
      </div>
    </Modal>
  );
}

function PriceHistoryModal({ token, product, onClose }: { token: string; product: Row; onClose: () => void }) {
  const { data } = useAsync(async () => (await api.products.priceHistory(token, String(product.id))) as Row[], [token, product.id]);
  return (
    <Modal title={`দামের ইতিহাস — ${String(product.name)}`} size="lg" onClose={onClose}>
      {(data ?? []).length === 0 ? (
        <Empty title="কোনো পরিবর্তন নেই" sub="দাম বদলালে এখানে কারণসহ দেখা যাবে।" icon={<History size={20} />} />
      ) : (
        <DataTable
          cols={[
            { key: 'created_at', label: 'তারিখ', render: (r) => fmtDate((r.changed_at as number) ?? null) },
            { key: 'field', label: 'ফিল্ড', render: (r) => String(r.field ?? '') },
            { key: 'before', label: 'আগে', align: 'right', render: (r) => <Money paise={Number(r.old_value ?? 0)} /> },
            { key: 'after', label: 'পরে', align: 'right', render: (r) => <Money paise={Number(r.new_value ?? 0)} /> },
            { key: 'reason', label: 'কারণ', render: (r) => String(r.reason ?? '—') },
            { key: 'user', label: 'কারী', render: (r) => String(r.user_name ?? '—') }
          ]}
          rows={(data ?? []) as Row[]}
        />
      )}
    </Modal>
  );
}
