/** Settings — business profile, financial rules, POS/receipt defaults,
 *  notifications, backup location, app info. All writes are audited. */
import React, { useEffect, useState } from 'react';
import { Save, Store, Coins, Receipt, Bell, Database, Info, ShieldCheck } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { Button, Field, TextInput, SelectInput, useToast, Bn } from '../../ui';

type SectionKey = 'business' | 'financial' | 'pos' | 'invoice' | 'notifications' | 'backup' | 'about';

const SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'business', label: 'ব্যবসার তথ্য', icon: <Store size={15} /> },
  { key: 'financial', label: 'আর্থিক', icon: <Coins size={15} /> },
  { key: 'pos', label: 'বিক্রয় (POS)', icon: <Receipt size={15} /> },
  { key: 'invoice', label: 'বিল/রসিদ', icon: <Receipt size={15} /> },
  { key: 'notifications', label: 'নোটিফিকেশন', icon: <Bell size={15} /> },
  { key: 'backup', label: 'ব্যাকআপ', icon: <Database size={15} /> },
  { key: 'about', label: 'সফটওয়্যার', icon: <Info size={15} /> }
];

export function SettingsPage() {
  const { user, can, business, refresh } = useSession();
  const token = user!.token;
  const [section, setSection] = useState<SectionKey>('business');
  const canManage = can('settings.manage');

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">সেটিংস</div>
          <div className="page-sub">অ্যাপের বৈশিষ্ট্য ও ব্যবসার তথ্য</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card" style={{ padding: 8 }}>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: 'none',
                background: section === s.key ? 'var(--c-primary-soft)' : 'transparent',
                color: section === s.key ? 'var(--c-primary)' : 'var(--c-ink-2)',
                fontWeight: section === s.key ? 700 : 500,
                fontSize: 'var(--fs-md)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 120ms ease'
              }}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </div>

        <div className="card card-pad">
          {section === 'business' && <BusinessSection token={token} business={business} canManage={canManage} onSaved={() => void refresh()} />}
          {section === 'financial' && <FinancialSection token={token} canManage={canManage} />}
          {section === 'pos' && <PosSection token={token} canManage={canManage} />}
          {section === 'invoice' && <InvoiceSection token={token} canManage={canManage} />}
          {section === 'notifications' && <NotificationsSection token={token} canManage={canManage} />}
          {section === 'backup' && <BackupSection token={token} canManage={canManage} />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <div className="card-title" style={{ fontSize: 'var(--fs-lg)' }}>{title}</div>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-3)', marginBottom: 16 }}>{sub}</p>
    </>
  );
}

function ReadOnlyBanner() {
  return (
    <div style={{ background: 'var(--c-surface-2)', borderRadius: 10, padding: '10px 14px', fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)', marginBottom: 14 }}>
      <ShieldCheck size={14} style={{ verticalAlign: -3, marginRight: 6 }} />
      আপনার অ্যাকাউন্টে সেটিংস পরিবর্তনের অধিকার নেই — দেখতে পারছেন, বদলাতে পারছেন না।
    </div>
  );
}

function BusinessSection({ token, business, canManage, onSaved }: { token: string; business: Row | null; canManage: boolean; onSaved: () => void }) {
  const toast = useToast();
  const b = business ?? {};
  const [name, setName] = useState(String(b.name ?? ''));
  const [owner, setOwner] = useState(String(b.owner_name ?? ''));
  const [phone, setPhone] = useState(String(b.phone ?? ''));
  const [email, setEmail] = useState(String(b.email ?? ''));
  const [address, setAddress] = useState(String(b.address ?? ''));
  const [type, setType] = useState(String(b.business_type ?? 'retail'));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!canManage || !name.trim()) return;
    setBusy(true);
    try {
      await api.business.update(
        token,
        { name: name.trim(), ownerName: owner.trim(), phone: phone.trim() || null, email: email.trim() || null, address: address.trim() || null, businessType: type }
      );
      toast('success', 'ব্যবসার তথ্য সংরক্ষিত');
      onSaved();
    } catch (e) {
      toast('error', 'সংরক্ষণ হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionHead title="ব্যবসার তথ্য" sub="এই তথ্য বিল/রসিদের হেডারে দেখা যায়।" />
      {!canManage && <ReadOnlyBanner />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 640 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="ব্যবসার নাম *">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
          </Field>
        </div>
        <Field label="মালিকের নাম">
          <TextInput value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!canManage} />
        </Field>
        <Field label="ফোন">
          <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" disabled={!canManage} />
        </Field>
        <Field label="ইমেইল">
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canManage} />
        </Field>
        <Field label="ধরন">
          <SelectInput value={type} onChange={(e) => setType(e.target.value)} disabled={!canManage}>
            <option value="retail">মুদি/রোড সাইড</option>
            <option value="supermarket">সুপারমার্কেট</option>
            <option value="pharmacy">ফার্মেসি</option>
            <option value="electronics">ইলেকট্রনিক্স</option>
            <option value="clothing">পোশাক</option>
            <option value="other">অন্যান্য</option>
          </SelectInput>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="ঠিকানা">
            <TextInput value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canManage} />
          </Field>
        </div>
      </div>
      {canManage && (
        <div style={{ marginTop: 18 }}>
          <Button variant="primary" icon={<Save size={15} />} loading={busy} disabled={!name.trim()} onClick={save}>
            সংরক্ষণ করুন
          </Button>
        </div>
      )}
    </div>
  );
}

function FinancialSection({ token, canManage }: { token: string; canManage: boolean }) {
  const toast = useToast();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setS(await api.settings.section(token, 'financial'));
    })();
  }, [token]);

  if (!s) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }
  const v = (k: string, d: unknown) => (s[k] === undefined ? d : s[k]);
  const num = (k: string, d: number) => Number(v(k, d)) || 0;

  async function save() {
    if (!canManage) return;
    setBusy(true);
    try {
      const entries = Object.entries(s ?? {});
      for (const [k, val] of entries) {
        await api.settings.set(token, 'financial', k, val);
      }
      toast('success', 'আর্থিক সেটিংস সংরক্ষিত');
      setS(await api.settings.section(token, 'financial'));
    } catch (e) {
      toast('error', 'সংরক্ষণ হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const boolRow = (key: string, label: string, hint: string, invert = false) => (
    <div className="checkbox-row" style={{ padding: '10px 0', borderBottom: '1px solid var(--c-border)' }}>
      <input
        type="checkbox"
        checked={!!v(key, !invert)}
        disabled={!canManage}
        onChange={(e) => setS({ ...s, [key]: e.target.checked })}
      />
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>{hint}</div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 640 }}>
      <SectionHead title="আর্থিক" sub="কর, নেগেটিভ স্টক ও হিসাবের নিয়ম — পুরো অ্যাপে প্রযোজ্য।" />
      {!canManage && <ReadOnlyBanner />}
      <div className="field" style={{ marginBottom: 12 }}>
        <label>কর</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="করের হার (%)">
            <TextInput
              inputMode="decimal"
              disabled={!canManage}
              value={num('tax_rate_bps', 0) ? String(num('tax_rate_bps', 0) / 100) : ''}
              placeholder="0"
              onChange={(e) => {
                const x = Number(e.target.value) || 0;
                setS({ ...s, tax_rate_bps: Math.round(x * 100), tax_enabled: x > 0 });
              }}
            />
          </Field>
          <Field label="দামে কর আছে?">
            <SelectInput value={v('tax_inclusive_prices', false) ? 'yes' : 'no'} disabled={!canManage} onChange={(e) => setS({ ...s, tax_inclusive_prices: e.target.value === 'yes' })}>
              <option value="no">না — বিলে আলাদা দেখাবে</option>
              <option value="yes">হ্যাঁ — দামেই কর আছে</option>
            </SelectInput>
          </Field>
        </div>
      </div>
      {boolRow('allow_negative_stock', 'নেগেটিভ স্টক অনুমোদন', 'অনুমোদন করলে স্টক শূন্যের নিচে নামতে পারবে (সতর্কভাবে)')}
      {boolRow('allow_negative_accounts', 'হিসাব ব্যালেন্সের ঋণাত্মকতা', 'অনুমোদন করলে ব্যালেন্স নেতিবাচক হতে পারবে')}
      {boolRow('block_sale_expired', 'মেয়াদোত্তীর্ণ পণ্য বিক্রি ব্লক', 'মেয়াদ শেষ হলে বিক্রি করা যাবে না')}
      {canManage && (
        <div style={{ marginTop: 18 }}>
          <Button variant="primary" icon={<Save size={15} />} loading={busy} onClick={save}>
            সংরক্ষণ করুন
          </Button>
        </div>
      )}
    </div>
  );
}

function PosSection({ token, canManage }: { token: string; canManage: boolean }) {
  const toast = useToast();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [pos, printer] = await Promise.all([api.settings.section(token, 'pos'), api.settings.section(token, 'printer')]);
      setS({ ...(pos as Record<string, unknown>), ...(printer as Record<string, unknown>) });
    })();
  }, [token]);

  if (!s) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }

  async function save() {
    if (!canManage) return;
    setBusy(true);
    try {
      for (const [k, val] of Object.entries(s ?? {})) {
        const section = k === 'default_printer' ? 'printer' : 'pos';
        await api.settings.set(token, section, k, val);
      }
      toast('success', 'POS সেটিংস সংরক্ষিত');
    } catch (e) {
      toast('error', 'সংরক্ষণ হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <SectionHead title="বিক্রয় (POS)" sub="বিলের পরের আচরণ ও প্রিন্টার।" />
      {!canManage && <ReadOnlyBanner />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="ডিফল্ট কাগজ">
          <SelectInput value={String(s.default_paper ?? '80mm')} disabled={!canManage} onChange={(e) => setS({ ...s, default_paper: e.target.value })}>
            <option value="80mm">80mm (থার্মাল)</option>
            <option value="57mm">57mm (থার্মাল)</option>
            <option value="A4">A4 (লেজার/ইনকজেট)</option>
          </SelectInput>
        </Field>
        <Field label="ডিফল্ট কাস্টমার মোড">
          <SelectInput value={String(s.default_customer_mode ?? 'walk_in')} disabled={!canManage} onChange={(e) => setS({ ...s, default_customer_mode: e.target.value })}>
            <option value="walk_in">প্রতি বিক্রয়ে সাধারণ কাস্টমার</option>
            <option value="last_used">আগের কাস্টমার রাখুন</option>
          </SelectInput>
        </Field>
        <div style={{ gridColumn: '1 / -1' }} className="checkbox-row">
          <input type="checkbox" checked={!!s.auto_print} disabled={!canManage} onChange={(e) => setS({ ...s, auto_print: e.target.checked })} />
          বিল হলেই রসিদ প্রিন্ট হবে
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="ডিফল্ট প্রিন্টার" hint="খালি রাখলে প্রতিবার সিস্টেমের ডিফল্ট প্রিন্টার ব্যবহার হবে">
            <TextInput value={String(s.default_printer ?? '')} placeholder="সিস্টেম ডিফল্ট" disabled={!canManage} onChange={(e) => setS({ ...s, default_printer: e.target.value })} />
          </Field>
        </div>
      </div>
      {canManage && (
        <div style={{ marginTop: 18 }}>
          <Button variant="primary" icon={<Save size={15} />} loading={busy} onClick={save}>
            সংরক্ষণ করুন
          </Button>
        </div>
      )}
    </div>
  );
}

function InvoiceSection({ token, canManage }: { token: string; canManage: boolean }) {
  const toast = useToast();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setS(await api.settings.section(token, 'invoice'));
    })();
  }, [token]);

  if (!s) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }

  async function save() {
    if (!canManage) return;
    setBusy(true);
    try {
      for (const [k, val] of Object.entries(s ?? {})) {
        await api.settings.set(token, 'invoice', k, val);
      }
      toast('success', 'বিল সেটিংস সংরক্ষিত');
    } catch (e) {
      toast('error', 'সংরক্ষণ হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <SectionHead title="বিল/রসিদ" sub="বিল নম্বরের ফরম্যাট ও রসিদের পাওয়া যাওয়া লেখা।" />
      {!canManage && <ReadOnlyBanner />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="বিল নম্বরের প্রিফিক্স">
          <TextInput value={String(s.prefix ?? 'INV')} disabled={!canManage} onChange={(e) => setS({ ...s, prefix: e.target.value })} />
        </Field>
        <Field label="নম্বরের দৈর্ঘ্য (ডিজিট)">
          <TextInput
            inputMode="numeric"
            value={String(s.width ?? 6)}
            disabled={!canManage}
            onChange={(e) => setS({ ...s, width: Math.max(1, Math.min(10, Number(e.target.value) || 6)) })}
          />
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="রসিদের ফুটার লেখা">
            <TextInput value={String(s.footer ?? 'ধন্যবাদ! আবার আসবেন।')} disabled={!canManage} onChange={(e) => setS({ ...s, footer: e.target.value })} />
          </Field>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="checkbox-row">
          <input type="checkbox" checked={!!s.show_customer_info} disabled={!canManage} onChange={(e) => setS({ ...s, show_customer_info: e.target.checked })} />
          রসিদে কাস্টমারের নাম/ফোন দেখাও
        </div>
      </div>
      {canManage && (
        <div style={{ marginTop: 18 }}>
          <Button variant="primary" icon={<Save size={15} />} loading={busy} onClick={save}>
            সংরক্ষণ করুন
          </Button>
        </div>
      )}
    </div>
  );
}

function NotificationsSection({ token, canManage }: { token: string; canManage: boolean }) {
  const toast = useToast();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setS(await api.settings.section(token, 'notifications'));
    })();
  }, [token]);

  if (!s) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }

  async function save() {
    if (!canManage) return;
    setBusy(true);
    try {
      for (const [k, val] of Object.entries(s ?? {})) {
        await api.settings.set(token, 'notifications', k, val);
      }
      toast('success', 'নোটিফিকেশন সেটিংস সংরক্ষিত');
    } catch (e) {
      toast('error', 'সংরক্ষণ হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const boolRow = (key: string, label: string, hint: string) => (
    <div className="checkbox-row" style={{ padding: '10px 0', borderBottom: '1px solid var(--c-border)' }}>
      <input type="checkbox" checked={!!s[key]} disabled={!canManage} onChange={(e) => setS({ ...s, [key]: e.target.checked })} />
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>{hint}</div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 640 }}>
      <SectionHead title="নোটিফিকেশন" sub="অ্যালার্ট চালু/বন্ধ — ড্যাশবোর্ড ও লগইনের সময় দেখা যাবে।" />
      {!canManage && <ReadOnlyBanner />}
      {boolRow('low_stock_enabled', 'কম স্টক অ্যালার্ট', 'পুনরায় অর্ডার সীমার নিচে নামলে জানানো হবে')}
      {boolRow('customer_due_enabled', 'কাস্টমার বকেয়া রিমাইন্ডার', 'প্রাপ্য টাকা পড়ে গেলে জানানো হবে')}
      {boolRow('supplier_payable_enabled', 'সাপ্লায়ার প্রদেয় রিমাইন্ডার', 'প্রদেয় টাকা পড়ে গেলে জানানো হবে')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Field label="মেয়াদ শেষ হওয়ার সতর্কতা (দিন)">
          <TextInput inputMode="numeric" value={String(s.expiring_days ?? 30)} disabled={!canManage} onChange={(e) => setS({ ...s, expiring_days: Number(e.target.value) || 30 })} />
        </Field>
        <Field label="ব্যাকআপ রিমাইন্ডার (দিন)">
          <TextInput inputMode="numeric" value={String(s.backup_reminder_days ?? 7)} disabled={!canManage} onChange={(e) => setS({ ...s, backup_reminder_days: Number(e.target.value) || 7 })} />
        </Field>
      </div>
      {canManage && (
        <div style={{ marginTop: 18 }}>
          <Button variant="primary" icon={<Save size={15} />} loading={busy} onClick={save}>
            সংরক্ষণ করুন
          </Button>
        </div>
      )}
    </div>
  );
}

function BackupSection({ token, canManage }: { token: string; canManage: boolean }) {
  const toast = useToast();
  const [dir, setDir] = useState<string | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoDays, setAutoDays] = useState(7);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [d, en, days] = await Promise.all([
        api.backup.directory(token),
        api.settings.get(token, 'backup', 'auto_enabled', false),
        api.settings.get(token, 'backup', 'auto_interval_days', 7)
      ]);
      setDir(d);
      setAutoEnabled(!!en);
      setAutoDays(Number(days) || 7);
    })();
  }, [token]);

  async function changeDir() {
    if (!canManage) return;
    setBusy(true);
    try {
      const d = await api.app.pickDirectory();
      if (d) {
        await api.settings.set(token, 'backup', 'directory', d);
        setDir(d);
        toast('success', 'ব্যাকআপ ফোল্ডার পরিবর্তিত', d);
      }
    } catch (e) {
      toast('error', 'পরিবর্তন হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleAuto(on: boolean) {
    if (!canManage) return;
    setAutoEnabled(on);
    try {
      await api.settings.set(token, 'backup', 'auto_enabled', on);
    } catch (e) {
      toast('error', 'সংরক্ষণ হয়নি', errMsg(e));
    }
  }

  async function saveDays() {
    if (!canManage) return;
    const d = Math.min(Math.max(1, Number(autoDays) || 7), 90);
    setAutoDays(d);
    try {
      await api.settings.set(token, 'backup', 'auto_interval_days', d);
      toast('success', 'স্বয়ংক্রিয় ব্যাকআপ সেটিংস সংরক্ষিত');
    } catch (e) {
      toast('error', 'সংরক্ষণ হয়নি', errMsg(e));
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <SectionHead title="ব্যাকআপ" sub="ব্যাকআপ ফাইল কোথায় রাখবে অ্যাপ।" />
      {!canManage && <ReadOnlyBanner />}
      <Field label="ব্যাকআপ ফোল্ডার">
        <div style={{ display: 'flex', gap: 8 }}>
          <code style={{ flex: 1, background: 'var(--c-surface-2)', padding: '9px 12px', borderRadius: 9, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dir ?? '…'}
          </code>
          <Button variant="outline" loading={busy} disabled={!canManage} onClick={changeDir}>
            পরিবর্তন
          </Button>
        </div>
      </Field>
      <div className="checkbox-row" style={{ padding: '12px 0', borderBottom: '1px solid var(--c-border)', marginTop: 12 }}>
        <input type="checkbox" checked={autoEnabled} disabled={!canManage} onChange={(e) => void toggleAuto(e.target.checked)} />
        <div>
          <div style={{ fontWeight: 600 }}>স্বয়ংক্রিয় ব্যাকআপ</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>
            অ্যাপ চালু হলে সময়মতো নিজে থেকেই ব্যাকআপ নেবে
          </div>
        </div>
      </div>
      {autoEnabled && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="কত দিন পর পর (দিন)">
            <TextInput inputMode="numeric" value={String(autoDays)} disabled={!canManage} onChange={(e) => setAutoDays(Number(e.target.value) || 7)} />
          </Field>
          {canManage && (
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button variant="outline" onClick={() => void saveDays()}>সংরক্ষণ করুন</Button>
            </div>
          )}
        </div>
      )}
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)', marginTop: 10 }}>
        {autoEnabled
          ? 'স্বয়ংক্রিয় ব্যাকআপ চালু আছে — তবু মাঝে মাঝে “ডেটা: ব্যাকআপ” পেজ থেকে নিজেও নেবেন।'
          : 'নিয়মিত (প্রতি সপ্তাহে) ম্যানুয়ালি ব্যাকআপ নেওয়ার অভ্যাস করুন — “ডেটা: ব্যাকআপ” পেজ থেকে।'}
      </p>
    </div>
  );
}

function AboutSection() {
  const { data: info } = useAsync(async () => await api.app.info(), []);
  return (
    <div style={{ maxWidth: 560 }}>
      <SectionHead title="সফটওয়্যার" sub="MERQO বিজনেস স্যুট — অফলাইনে চলে, ডেটা এই মেশিনেই থাকে।" />
      <div className="detail-grid">
        <div className="detail-cell"><span className="k">সংস্করণ</span><span className="v"><Bn>{String(info?.version ?? '—')}</Bn></span></div>
        <div className="detail-cell"><span className="k">স্কিমা সংস্করণ</span><span className="v"><Bn>{String(info?.schemaVersion ?? '—')}</Bn></span></div>
        <div className="detail-cell" style={{ gridColumn: '1 / -1' }}>
          <span className="k">ডেটা ফোল্ডার</span>
          <span className="v"><code style={{ fontSize: 'var(--fs-sm)' }}>{String(info?.dataDirectory ?? '—')}</code></span>
        </div>
      </div>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-3)', marginTop: 14, lineHeight: 1.6 }}>
        MERQO কোনো ইন্টারনেট সার্ভারে ডেটা পাঠায় না। পুরো ব্যবসার হিসাব এই কম্পিউটারের SQLite ডাটাবেসে
        সংরক্ষিত।
      </p>
    </div>
  );
}
