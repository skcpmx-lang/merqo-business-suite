/** Users & permissions — profile, user management (owner), role
 *  permission sets (owner), and the immutable audit trail. */
import React, { useState } from 'react';
import { UserPlus, ScrollText, KeyRound, Pencil, Lock } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useAsync } from '../../lib/useAsync';
import { api, errMsg, idemKey } from '../../lib/api';
import type { Row, LoginResult } from '@shared/ipc';
import { Button, Modal, Field, TextInput, SelectInput, useToast, DataTable, type Col, fmtDateTime, Bn, Tabs } from '../../ui';
import { PERMISSIONS, ROLE_CATALOG, type RoleKey } from '../../../shared/permissions';

const PERM_LABELS: Record<string, string> = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label]));

interface UserView {
  id: string;
  name: string;
  username: string;
  roleName: string;
  roleKey: string;
  isOwner: boolean;
  isActive: boolean;
  lastLoginAt: number | null;
  permissions: string[];
}

export function UsersAdmin() {
  const { user, can } = useSession();
  const token = user!.token;
  const isOwner = user!.isOwner;
  const [tab, setTab] = useState('profile');
  const [editing, setEditing] = useState<UserView | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserView | null>(null);

  const { data: users, reload } = useAsync(async () => (await api.users.list(token)) as unknown as UserView[], [token]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">ব্যবহারকারী ও অডিট</div>
          <div className="page-sub">
            {isOwner ? 'ব্যবহারকারী, ভূমিকা-অধিকার, অডিট লগ' : 'আপনার প্রোফাইল ও পাসওয়ার্ড'}
          </div>
        </div>
        <div className="toolbar">
          {isOwner && (
            <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setEditing('new')}>নতুন ব্যবহারকারী</Button>
          )}
        </div>
      </div>

      <Tabs
        tabs={
          isOwner
            ? [
                { key: 'profile', label: 'আমার প্রোফাইল' },
                { key: 'users', label: 'ব্যবহারকারী' },
                { key: 'roles', label: 'ভূমিকা ও অধিকার' },
                { key: 'audit', label: 'অডিট লগ' }
              ]
            : [{ key: 'profile', label: 'আমার প্রোফাইল' }]
        }
        active={tab}
        onChange={setTab}
      />
      <div style={{ height: 14 }} />

      {tab === 'profile' && (
        <ProfileCard
          user={user!}
          onPassword={async (current, next) => {
            await api.users.changePassword(token, { currentPassword: current, newPassword: next });
          }}
        />
      )}

      {isOwner && tab === 'users' && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>নাম</th><th>ইউজারনেম</th><th>ভূমিকা</th><th>অধিকার</th><th>অবস্থা</th><th>শেষ লগইন</th><th></th></tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} style={u.username === user!.username ? { background: 'var(--c-primary-soft)' } : undefined}>
                  <td>
                    <strong>{u.name}</strong>
                    {u.username === user!.username && <span style={{ color: 'var(--c-primary)', fontSize: 'var(--fs-xs)', marginLeft: 8 }}>আপনি</span>}
                  </td>
                  <td><code style={{ fontSize: 'var(--fs-xs)' }}>{u.username}</code></td>
                  <td><RoleBadge roleKey={u.roleKey} isOwner={u.isOwner} /></td>
                  <td style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-2)' }}>
                    {u.isOwner ? 'সব অধিকার' : <><Bn>{u.permissions.length}</Bn>টি অধিকার</>}
                  </td>
                  <td>{u.isActive ? <span className="badge badge-green">সক্রিয়</span> : <span className="badge badge-gray">নিষ্ক্রিয়</span>}</td>
                  <td style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-3)' }}>{fmtDateTime(u.lastLoginAt)}</td>
                  <td>
                    <div className="tbl-row-actions">
                      {!u.isOwner && (
                        <>
                          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(u)}>সম্পাদনা</Button>
                          <Button size="sm" variant="ghost" icon={<KeyRound size={13} />} onClick={() => setResetting(u)}>পাসওয়ার্ড</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isOwner && tab === 'roles' && <RolesPanel token={token} />}

      {isOwner && tab === 'audit' && <AuditLog token={token} />}

      {editing && <UserFormModal user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function RoleBadge({ roleKey, isOwner }: { roleKey: string; isOwner: boolean }) {
  const cat = ROLE_CATALOG.find((r) => r.key === roleKey);
  if (isOwner || roleKey === 'owner') return <span className="badge badge-purple">মালিক</span>;
  return (
    <span className={`badge ${roleKey === 'manager' ? 'badge-blue' : roleKey === 'cashier' ? 'badge-gray' : 'badge-green'}`}>
      {cat?.label ?? roleKey}
    </span>
  );
}

function ProfileCard({ user, onPassword }: { user: LoginResult; onPassword: (current: string, next: string) => Promise<unknown> }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function changePassword() {
    if (!current || !next) return;
    if (next !== confirm) {
      toast('error', 'পাসওয়ার্ড মেলেছে না', 'নতুন পাসওয়ার্ড দুটো লেখা একই হতে হবে।');
      return;
    }
    setBusy(true);
    try {
      await onPassword(current, next);
      toast('success', 'পাসওয়ার্ড পরিবর্তিত হয়েছে');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      toast('error', 'পরিবর্তন হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const perms: string[] = user.isOwner ? PERMISSIONS.map((p) => p.label) : user.permissions.map((k) => PERM_LABELS[k] ?? k);

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div className="card card-pad">
        <div className="card-title">আপনার প্রোফাইল</div>
        <div className="detail-grid">
          <div className="detail-cell"><span className="k">নাম</span><span className="v">{String(user.name)}</span></div>
          <div className="detail-cell"><span className="k">ইউজারনেম</span><span className="v">{String(user.username)}</span></div>
          <div className="detail-cell"><span className="k">ভূমিকা</span><span className="v">{String(user.roleName ?? '—')}</span></div>
        </div>
        <div className="divider" />
        <div className="card-title" style={{ fontSize: 'var(--fs-sm)' }}>আপনার অধিকার</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflow: 'auto' }}>
          {perms.map((p, i) => (
            <span key={i} className="badge badge-gray">{p}</span>
          ))}
        </div>
      </div>
      <div className="card card-pad">
        <div className="card-title"><KeyRound size={16} /> পাসওয়ার্ড পরিবর্তন</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="বর্তমান পাসওয়ার্ড">
            <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="নতুন পাসওয়ার্ড" hint="কমপক্ষে ৪ অক্ষর">
              <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="আবার লিখুন">
              <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          </div>
          <Button variant="primary" loading={busy} disabled={!current || next.length < 4} onClick={changePassword}>
            পাসওয়ার্ড পরিবর্তন করুন
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserFormModal({ user, onClose, onDone }: { user: UserView | null; onClose: () => void; onDone: () => void }) {
  const { user: me } = useSession();
  const toast = useToast();
  const token = me!.token;
  const isEdit = !!user;
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>(user?.roleKey ?? 'cashier');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    if (!isEdit && (!username.trim() || password.length < 4)) return;
    setBusy(true);
    try {
      if (isEdit) {
        await api.users.update(token, { userId: user!.id, name: name.trim(), roleKey: role, isActive: active });
        toast('success', 'ব্যবহারকারী আপডেট হয়েছে');
      } else {
        await api.users.create(token, { name: name.trim(), username: username.trim(), password, roleKey: role }, idemKey());
        toast('success', 'নতুন ব্যবহারকারী যোগ হয়েছে');
      }
      onDone();
    } catch (e) {
      toast('error', isEdit ? 'আপডেট হয়নি' : 'যোগ হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const roleOptions = ROLE_CATALOG.filter((r) => r.key !== 'owner');

  return (
    <Modal
      title={isEdit ? 'ব্যবহারকারী সম্পাদনা' : 'নতুন ব্যবহারকারী'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || (!isEdit && (!username.trim() || password.length < 4))} onClick={save}>
            সংরক্ষণ করুন
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="নাম *">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus={!isEdit} />
          </Field>
          <Field label="ভূমিকা" hint="ভূমিকার সাথে ডিফল্ট অধিকার সেট — “ভূমিকা ও অধিকার” ট্যাবে বদলাতে পারবেন">
            <SelectInput value={role} onChange={(e) => setRole(e.target.value)}>
              {roleOptions.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </SelectInput>
          </Field>
        </div>
        {!isEdit ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="ইউজারনেম *" hint="লগইনের জন্য, ছোট হরফ">
              <TextInput value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="যেমন: rahim" />
            </Field>
            <Field label="শুরুকারী পাসওয়ার্ড *" hint="কমপক্ষে ৪ অক্ষর">
              <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </div>
        ) : (
          <label className="checkbox-row">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            সক্রিয় (লগইন করতে পারবে)
          </label>
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserView; onClose: () => void }) {
  const { user: me } = useSession();
  const toast = useToast();
  const token = me!.token;
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (password.length < 4) return;
    setBusy(true);
    try {
      await api.users.changePassword(token, { userId: user.id, newPassword: password });
      toast('success', 'পাসওয়ার্ড রিসেট হয়েছে', `${user.name} এখন নতুন পাসওয়ার্ডে লগইন করবেন।`);
      onClose();
    } catch (e) {
      toast('error', 'রিসেট হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`পাসওয়ার্ড রিসেট — ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>বাতিল</Button>
          <Button variant="primary" icon={<KeyRound size={15} />} loading={busy} disabled={password.length < 4} onClick={save}>
            রিসেট করুন
          </Button>
        </>
      }
    >
      <Field label="নতুন পাসওয়ার্ড *" hint="কমপক্ষে ৪ অক্ষর">
        <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

function RolesPanel({ token }: { token: string }) {
  const toast = useToast();
  const { data: roles, reload } = useAsync(async () => (await api.roles.list(token)) as Row[], [token]);
  const [selected, setSelected] = useState<string | null>(null);
  const role = (roles ?? []).find((r) => String(r.id) === selected) ?? (roles ?? [])[0];

  const { data: perms, reload: reloadPerms } = useAsync(
    async () => (role ? (await api.roles.permissions(token, String(role.id))) as string[] : []),
    [token, role?.id]
  );
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const effective = draft ?? new Set(perms ?? []);
  const [busy, setBusy] = useState(false);
  const isOwnerRole = role && (String(role.key) === 'owner');

  async function save() {
    if (!role || !draft) return;
    setBusy(true);
    try {
      await api.roles.setPermissions(token, String(role.id), [...draft], idemKey());
      toast('success', 'ভূমিকার অধিকার সংরক্ষিত');
      setDraft(null);
      reloadPerms();
      reload();
    } catch (e) {
      toast('error', 'সংরক্ষণ হয়নি', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 8 }}>
        {(roles ?? []).map((r) => (
          <button
            key={String(r.id)}
            onClick={() => {
              setSelected(String(r.id));
              setDraft(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '10px 12px',
              borderRadius: 10,
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              background: String(role?.id) === String(r.id) ? 'var(--c-primary-soft)' : 'transparent',
              color: String(role?.id) === String(r.id) ? 'var(--c-primary)' : 'var(--c-ink-2)',
              fontWeight: String(role?.id) === String(r.id) ? 700 : 500,
              fontSize: 'var(--fs-md)'
            }}
          >
            {String(r.name)}
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)', fontWeight: 400 }}>
              <Bn>{String(r.permission_count ?? 0)}</Bn>টি অধিকার
            </div>
          </button>
        ))}
      </div>

      {role && (
        <div className="card card-pad">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="card-title" style={{ margin: 0 }}>
              {String(role.name)} {isOwnerRole ? <Lock size={14} style={{ verticalAlign: -2 }} /> : null}
            </div>
            <div style={{ flex: 1 }} />
            {!isOwnerRole && (
              <Button variant="primary" loading={busy} disabled={!draft || draft.size === (perms?.length ?? 0)} onClick={save}>
                সংরক্ষণ করুন
              </Button>
            )}
          </div>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-3)', margin: '8px 0 14px' }}>
            {isOwnerRole
              ? 'মালিক ভূমিকার সব কাজের অধিকার আছে — পরিবর্তন করা যায় না।'
              : `এই ভূমিকার ব্যবহারকারীরা নিচের কাজগুলো করতে পারবে। ডিফল্ট: ${String(role.key) === 'manager' ? 'সব ব্যবসা কাজ' : String(role.key) === 'cashier' ? 'POS ও ক্যাশ' : 'বাছাই করা কাজ'}`}
          </p>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="checkbox-row" style={{ padding: '5px 0', opacity: isOwnerRole ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  disabled={!!isOwnerRole}
                  checked={effective.has(p.key)}
                  onChange={() => {
                    const n = new Set(draft ?? perms ?? []);
                    if (n.has(p.key)) n.delete(p.key);
                    else n.add(p.key);
                    setDraft(n);
                  }}
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditLog({ token }: { token: string }) {
  const { data, reload } = useAsync(async () => (await api.audit.query(token, { limit: 100 })) as { rows: Row[]; total: number }, [token]);
  const rows = data?.rows ?? [];
  const cols: Col<Row>[] = [
    { key: 'created_at', label: 'সময়', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDateTime((r.created_at as number) ?? null)}</span> },
    { key: 'user_name', label: 'ব্যবহারকারী', render: (r) => String(r.user_name ?? r.username ?? '—') },
    { key: 'action', label: 'অ্যাকশন', render: (r) => <code style={{ fontSize: 'var(--fs-xs)', background: 'var(--c-surface-2)', padding: '2px 7px', borderRadius: 5 }}>{String(r.action)}</code> },
    {
      key: 'entity_type', label: 'বিষয়', render: (r) => (
        <span>
          {String(r.entity_type ?? '—')}
          {r.entity_id ? <span style={{ color: 'var(--c-ink-3)', fontSize: 'var(--fs-xs)' }}> {String(r.entity_id).slice(-8)}</span> : null}
        </span>
      )
    },
    {
      key: 'detail', label: 'বিস্তারিত', render: (r) => {
        const d = (r.detail as Record<string, unknown> | null) ?? (r.after as Record<string, unknown> | null) ?? {};
        const parts: string[] = [];
        if (d.before || d.after) {
          const b = d.before as Record<string, unknown> | undefined;
          const a = d.after as Record<string, unknown> | undefined;
          const changed = Object.keys(a ?? {}).filter((k) => JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k]));
          if (changed.length) parts.push('পরিবর্তন: ' + changed.slice(0, 4).map((k) => `${k}: ${String(b?.[k] ?? '—')} → ${String(a?.[k] ?? '—')}`).join(', '));
        } else {
          parts.push(
            ...Object.entries(d)
              .slice(0, 4)
              .map(([k, v]) => `${k}: ${String(typeof v === 'object' ? JSON.stringify(v) : v)}`)
          );
        }
        return <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-ink-3)' }}>{parts.join(' · ') || '—'}</span>;
      }
    }
  ];
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--c-ink-3)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ScrollText size={14} /> সাম্প্রতিক <Bn>{rows.length}</Bn>টি এন্ট্রি — অডিট লগ কখনো মুছে যায় না
        </span>
      </div>
      <DataTable
        cols={cols}
        rows={rows}
        emptyTitle="কোনো অডিট এন্ট্রি নেই"
        emptySub="ক্রিটিক্যাল অ্যাকশন (বিল ভয়েড, স্টক অ্যাডজাস্ট, ব্যাকআপ পুনরুদ্ধার…) এখানে লেখা হবে"
        emptyIcon={<ScrollText size={20} />}
      />
    </div>
  );
}
