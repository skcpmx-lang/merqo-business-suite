/** Application shell: sidebar navigation + topbar (global search,
 *  notifications) + module router. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, Boxes, ShoppingBag, ReceiptText,
  Users, Truck, Wallet, Landmark, ClipboardList, Smartphone, BarChart3,
  DatabaseBackup, UserCog, Settings, LogOut, Search, Bell, CircleDollarSign,
  ArrowLeftRight, FileSpreadsheet, FolderOpen
} from 'lucide-react';
import { useSession } from '../../lib/session';
import { api } from '../../lib/api';
import type { Row } from '@shared/ipc';
import { fmtDateTime } from '../../ui';
import { Dashboard } from '../dashboard/Dashboard';
import { Pos } from '../pos/Pos';
import { Products } from '../products/Products';
import { Inventory } from '../inventory/Inventory';
import { Purchases } from '../purchases/Purchases';
import { Sales } from '../sales/Sales';
import { Customers } from '../customers/Customers';
import { Suppliers } from '../suppliers/Suppliers';
import { Expenses } from '../expenses/Expenses';
import { Accounts } from '../accounts/Accounts';
import { Shift } from '../shift/Shift';
import { Mfs } from '../mfs/Mfs';
import { Reports } from '../reports/Reports';
import { DataCenter } from '../datacenter/DataCenter';
import { UsersAdmin } from '../users/Users';
import { SettingsPage } from '../settings/Settings';

export type ModuleKey =
  | 'dashboard' | 'pos' | 'products' | 'inventory' | 'purchases' | 'sales'
  | 'customers' | 'suppliers' | 'expenses' | 'accounts' | 'shift' | 'mfs'
  | 'reports' | 'data' | 'users' | 'settings';

interface NavItem {
  key: ModuleKey;
  label: string;
  icon: React.ReactNode;
  perm?: string;
  group: string;
}

const NAV: NavItem[] = [
  { key: 'dashboard', label: 'ড্যাশবোর্ড', icon: <LayoutDashboard size={17} />, group: 'মূল' },
  { key: 'pos', label: 'বিক্রয় (POS)', icon: <ShoppingCart size={17} />, group: 'মূল' },
  { key: 'sales', label: 'বিক্রয়ের হিসাব', icon: <ReceiptText size={17} />, perm: 'sales.view', group: 'মূল' },

  { key: 'products', label: 'পণ্য', icon: <Package size={17} />, perm: 'products.view', group: 'পণ্য ও পার্টি' },
  { key: 'inventory', label: 'ইনভেন্টরি', icon: <Boxes size={17} />, perm: 'stock.view', group: 'পণ্য ও পার্টি' },
  { key: 'purchases', label: 'ক্রয়', icon: <ShoppingBag size={17} />, perm: 'purchases.view', group: 'পণ্য ও পার্টি' },
  { key: 'customers', label: 'কাস্টমার', icon: <Users size={17} />, perm: 'customers.view', group: 'পণ্য ও পার্টি' },
  { key: 'suppliers', label: 'সাপ্লায়ার', icon: <Truck size={17} />, perm: 'suppliers.view', group: 'পণ্য ও পার্টি' },

  { key: 'expenses', label: 'খরচ', icon: <ClipboardList size={17} />, perm: 'expenses.create', group: 'হিসাব-নিকাশ' },
  { key: 'accounts', label: 'হিসাব ও ট্রান্সফার', icon: <Landmark size={17} />, perm: 'accounts.view', group: 'হিসাব-নিকাশ' },
  { key: 'shift', label: 'শিফট / ক্যাশ', icon: <CircleDollarSign size={17} />, perm: 'shift.open', group: 'হিসাব-নিকাশ' },
  { key: 'mfs', label: 'MFS এজেন্ট', icon: <Smartphone size={17} />, perm: 'mfs.view', group: 'হিসাব-নিকাশ' },
  { key: 'reports', label: 'রিপোর্ট', icon: <BarChart3 size={17} />, perm: 'reports.view', group: 'হিসাব-নিকাশ' },

  { key: 'data', label: 'ডেটা: ব্যাকআপ/আমদানি', icon: <DatabaseBackup size={17} />, group: 'প্যানেল' },
  { key: 'users', label: 'ব্যবহারকারী ও অডিট', icon: <UserCog size={17} />, perm: 'users.manage', group: 'প্যানেল' },
  { key: 'settings', label: 'সেটিংস', icon: <Settings size={17} />, group: 'প্যানেল' }
];

function GlobalSearch() {
  const { user, can } = useSession();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const token = user!.token;

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setResults(await api.search.global(token, term.trim()));
        setOpen(true);
      } catch {
        setResults(null);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [term, token]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  if (!can('sales.view')) return null;

  const groups: { label: string; key: keyof NonNullable<Row>; itemLabel: (r: Row) => string; itemSub: (r: Row) => string }[] = [
    { label: 'পণ্য', key: 'products', itemLabel: (r) => String(r.name ?? ''), itemSub: (r) => `স্টক: ${r.quantity ?? 0}` },
    { label: 'কাস্টমার', key: 'customers', itemLabel: (r) => String(r.name ?? ''), itemSub: (r) => String(r.phone ?? '') },
    { label: 'সাপ্লায়ার', key: 'suppliers', itemLabel: (r) => String(r.name ?? ''), itemSub: (r) => String(r.phone ?? '') },
    { label: 'বিক্রয়', key: 'sales', itemLabel: (r) => String(r.reference_no ?? ''), itemSub: (r) => `৳${(((r.total_paise as number) ?? 0) / 100).toLocaleString('en-IN')}` },
    { label: 'ক্রয়', key: 'purchases', itemLabel: (r) => String(r.reference_no ?? ''), itemSub: (r) => `৳${(((r.total_paise as number) ?? 0) / 100).toLocaleString('en-IN')}` }
  ];

  return (
    <div className="global-search" ref={boxRef}>
      <Search size={15} />
      <input
        className="input"
        placeholder="খুঁজুন: পণ্য, কাস্টমার, বিল…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => results && setOpen(true)}
      />
      {open && results && (
        <div className="search-pop">
          {groups.every((g) => !((results[g.key] as Row[]) ?? []).length) && (
            <div style={{ padding: '14px', fontSize: 'var(--fs-sm)', color: 'var(--c-ink-3)' }}>
              কিছু পাওয়া যায়নি
            </div>
          )}
          {groups.map((g) => {
            const items = (results[g.key] as Row[]) ?? [];
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <div className="group">{g.label}</div>
                {items.map((it, i) => (
                  <div
                    key={i}
                    className="item"
                    onClick={() => {
                      setOpen(false);
                      setTerm('');
                      window.dispatchEvent(new CustomEvent('merqo:navigate', { detail: g.key === 'products' ? 'products' : g.key }));
                    }}
                  >
                    <span>{g.itemLabel(it)}</span>
                    <span className="kind">{g.itemSub(it)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const { user, can } = useSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Row[]>([]);
  const [unread, setUnread] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const token = user!.token;

  const load = useCallback(async () => {
    try {
      const [list, u] = await Promise.all([api.notifications.list(token, 20), api.notifications.unread(token)]);
      setItems(list);
      setUnread(u);
    } catch {
      // no permission — hide later
    }
  }, [token]);

  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), 30000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  if (!can('notifications.view')) return null;

  return (
    <div style={{ position: 'relative' }} ref={boxRef}>
      <button className="bell" onClick={() => setOpen((o) => !o)} aria-label="নোটিফিকেশন">
        <Bell size={18} />
        {unread > 0 && <span className="dot">{unread > 99 ? '৯৯+' : String(unread)}</span>}
      </button>
      {open && (
        <div className="notif-pop">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-border)' }}>
            <strong style={{ fontSize: 'var(--fs-md)' }}>নোটিফিকেশন</strong>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try {
                  await api.notifications.readAll(token);
                  await load();
                } catch (e) {
                  // ignore
                }
              }}
            >
              সব পঠিত
            </button>
          </div>
          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-ink-3)', fontSize: 'var(--fs-sm)' }}>
              এখনো কোনো নোটিফিকেশন নেই
            </div>
          ) : (
            items.map((n) => (
              <div key={String(n.id)} className={`notif-item${n.is_read ? '' : ' unread'}`}>
                <div className="t">{String(n.title ?? '')}</div>
                <div className="m">{String(n.message ?? '')}</div>
                <div className="d">
                  {fmtDateTime((n.created_at as number) ?? null)}
                  {!n.is_read && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: 8, height: 22 }}
                      onClick={async () => {
                        try {
                          await api.notifications.read(token, String(n.id));
                          await load();
                        } catch (e) {
                          void e;
                        }
                      }}
                    >
                      পঠিত
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const { user, business, logout, can } = useSession();
  const [module, setModule] = useState<ModuleKey>('dashboard');

  useEffect(() => {
    const onNav = (e: Event) => {
      const m = (e as CustomEvent).detail as ModuleKey;
      if (m && NAV.some((n) => n.key === m)) setModule(m);
    };
    window.addEventListener('merqo:navigate', onNav);
    return () => window.removeEventListener('merqo:navigate', onNav);
  }, []);

  const visibleNav = NAV.filter((n) => !n.perm || can(n.perm));
  const groups: string[] = [];
  for (const n of visibleNav) if (!groups.includes(n.group)) groups.push(n.group);

  const initial = (user?.name ?? 'M').trim().charAt(0);

  const pages: Record<ModuleKey, React.ReactNode> = {
    dashboard: <Dashboard />,
    pos: <Pos />,
    products: <Products />,
    inventory: <Inventory />,
    purchases: <Purchases />,
    sales: <Sales />,
    customers: <Customers />,
    suppliers: <Suppliers />,
    expenses: <Expenses />,
    accounts: <Accounts />,
    shift: <Shift />,
    mfs: <Mfs />,
    reports: <Reports />,
    data: <DataCenter />,
    users: <UsersAdmin />,
    settings: <SettingsPage />
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #1b4a3e, #2fae83)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 16
            }}
          >
            M
          </div>
          <div>
            <div className="name">MERQO</div>
            <div className="tag">বিক্রয় ব্যবস্থাপনা</div>
          </div>
        </div>

        {groups.map((g) => (
          <React.Fragment key={g}>
            <div className="nav-group">{g}</div>
            {visibleNav
              .filter((n) => n.group === g)
              .map((n) => (
                <button
                  key={n.key}
                  className={`nav-item${module === n.key ? ' active' : ''}`}
                  onClick={() => setModule(n.key)}
                >
                  {n.icon}
                  {n.label}
                </button>
              ))}
          </React.Fragment>
        ))}

        <div className="sidebar-foot">
          <div className="avatar">{initial}</div>
          <div className="who">
            <div className="n">{user?.name}</div>
            <div className="r">{user?.roleName}</div>
          </div>
          <button className="logout" onClick={() => void logout()} title="লগআউট">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="biz">{business?.name}</div>
          </div>
          <div className="spacer" />
          <GlobalSearch />
          <Notifications />
        </header>
        <main className="content fade-up" key={module}>
          {pages[module]}
        </main>
      </div>
    </div>
  );
}
