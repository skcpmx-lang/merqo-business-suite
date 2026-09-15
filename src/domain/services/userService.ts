/**
 * User & session service (§55, §56).
 *
 *  - scrypt password hashing with per-user salt
 *  - sessions tracked in DB (auditable login/logout)
 *  - login lockout after repeated failures
 *  - permission resolution: user → role → role_permissions
 *  - permission checks live HERE (main process), never only in the UI
 */
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/connection';
import { tx } from '../db/connection';
import { generateId } from '../../shared/ids';
import { recordAudit } from './auditService';
import { getSetting } from '../repos/settings';
import { ValidationError, UnauthorizedError, NotFoundError, ConflictError } from '../errors';
import { hashPassword, verifyPassword } from './setupService';
import { ROLE_CATALOG, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, type RoleKey } from '../../shared/permissions';

export interface AuthUser {
  id: string;
  businessId: string;
  name: string;
  username: string;
  roleId: string;
  roleName: string;
  isOwner: boolean;
  permissions: string[];
}

export interface SessionUser extends AuthUser {
  sessionId: string;
}

export interface LoginResult extends SessionUser {
  token: string;
}

export function login(
  db: DB,
  businessId: string,
  username: string,
  password: string
): LoginResult {
  const now = Date.now();
  const maxFailed = getSetting<number>(db, businessId, 'security', 'max_failed_logins', 5);
  const lockoutMinutes = getSetting<number>(db, businessId, 'security', 'lockout_minutes', 10);

  const recent = db
    .prepare(
      'SELECT success FROM login_attempts WHERE business_id = ? AND username = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(businessId, username.trim().toLowerCase(), now - lockoutMinutes * 60_000, maxFailed) as { success: number }[];
  const failedCount = recent.filter((r) => r.success === 0).length;
  if (failedCount >= maxFailed) {
    throw new UnauthorizedError('কয়েকবার ভুল চেষ্টার পরে নিরাপত্তার জন্য লগইন আটকে রাখা হয়েছে। পরে চেষ্টা করুন।');
  }

  const user = db
    .prepare('SELECT * FROM users WHERE business_id = ? AND username = ? AND is_active = 1')
    .get(businessId, username.trim().toLowerCase()) as
    | { id: string; name: string; username: string; password_hash: string; password_salt: string; role_id: string; is_owner: number }
    | undefined;

  const ok = user && verifyPassword(password, user.password_salt, user.password_hash);
  db.prepare(
    'INSERT INTO login_attempts (id, business_id, username, success, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(generateId(), businessId, username.trim().toLowerCase(), ok ? 1 : 0, now);

  if (!ok) {
    throw new UnauthorizedError('ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।');
  }

  const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(user.role_id) as { name: string };
  const permissions = (db
    .prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
    .all(user.role_id) as { permission_key: string }[])
    .map((r) => r.permission_key);

  const sessionId = generateId();
  const token = randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (id, business_id, user_id, started_at, status, created_at, token_hash)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(sessionId, businessId, user.id, now, now, hashToken(token));

  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);
  recordAudit(db, {
    businessId, userId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, at: now
  });

  return {
    id: user.id,
    businessId,
    name: user.name,
    username: user.username,
    roleId: user.role_id,
    roleName: role?.name ?? '—',
    isOwner: user.is_owner === 1,
    permissions,
    sessionId,
    token
  };
}

export function logout(db: DB, sessionId: string): void {
  const row = db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(sessionId) as { id: string; business_id: string; user_id: string } | undefined;
  if (!row) return;
  db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(Date.now(), sessionId);
  recordAudit(db, { businessId: row.business_id, userId: row.user_id, action: 'auth.logout', entityType: 'user', entityId: row.user_id });
}

/** Map of active session tokens (hashed) → session row, kept in memory. */
export class SessionRegistry {
  private tokens = new Map<string, string>(); // sha256(token) → sessionId

  register(token: string, sessionId: string): void {
    this.tokens.set(sha256hex(token), sessionId);
  }

  resolve(db: DB, token: string): SessionUser | null {
    const sessionId = this.tokens.get(sha256hex(token));
    if (!sessionId) return null;
    const row = db
      .prepare(
        `SELECT s.*, u.name, u.username, u.role_id, u.is_owner, r.name AS role_name
         FROM sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE s.id = ? AND s.status = 'active'`
      )
      .get(sessionId) as
      | {
          id: string; business_id: string; name: string; username: string;
          role_id: string; is_owner: number; role_name: string | null;
        }
      | undefined;
    if (!row) return null;
    const permissions = (db
      .prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
      .all(row.role_id) as { permission_key: string }[])
      .map((r) => r.permission_key);
    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      username: row.username,
      roleId: row.role_id,
      roleName: row.role_name ?? '—',
      isOwner: row.is_owner === 1,
      permissions,
      sessionId: row.id
    };
  }

  remove(token: string): void {
    this.tokens.delete(sha256hex(token));
  }
}

function sha256hex(input: string): string {
  // lazy require to avoid crypto import cycles at module init in some bundlers
  const { createHash } = require('node:crypto');
  return createHash('sha256').update(input).digest('hex');
}

export function hashToken(token: string): string {
  return sha256hex(token);
}

/**
 * Resolve a bearer token to its active session user (DB-backed, survives
 * app restarts). Returns null when the token is unknown or the session is
 * ended. Used by the IPC layer for every business request.
 */
export function resolveSession(db: DB, token: string): SessionUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.business_id, u.id AS user_id, u.name, u.username,
              u.role_id, u.is_owner, r.name AS role_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE s.token_hash = ? AND s.status = 'active'`
    )
    .get(hashToken(token)) as
    | {
        session_id: string; business_id: string; user_id: string;
        name: string; username: string; role_id: string;
        is_owner: number; role_name: string | null;
      }
    | undefined;
  if (!row) return null;
  const permissions = (db
    .prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
    .all(row.role_id) as { permission_key: string }[])
    .map((r) => r.permission_key);
  return {
    id: row.user_id,
    businessId: row.business_id,
    name: row.name,
    username: row.username,
    roleId: row.role_id,
    roleName: row.role_name ?? '—',
    isOwner: row.is_owner === 1,
    permissions,
    sessionId: row.session_id
  };
}

export interface UserView {
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

export function listUsers(db: DB, businessId: string): UserView[] {
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.username, u.is_owner, u.is_active, u.last_login_at, u.role_id,
              r.name AS role_name, r.key AS role_key
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.business_id = ? ORDER BY u.is_owner DESC, u.name COLLATE NOCASE ASC`
    )
    .all(businessId) as Record<string, unknown>[];
  return users.map((u) => ({
    id: u.id as string,
    name: u.name as string,
    username: u.username as string,
    roleName: u.role_name as string,
    roleKey: u.role_key as string,
    isOwner: (u.is_owner as number) === 1,
    isActive: (u.is_active as number) === 1,
    lastLoginAt: (u.last_login_at as number | null) ?? null,
    permissions: (db
      .prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
      .all(u.role_id as string) as { permission_key: string }[])
      .map((r) => r.permission_key)
  }));
}

export function createUser(
  db: DB,
  input: {
    businessId: string;
    name: string;
    username: string;
    password: string;
    roleKey: string;
    pin?: string;
    userId?: string;
  }
): string {
  if (!input.name?.trim()) throw new ValidationError('নাম দিন।');
  if (!input.username?.trim()) throw new ValidationError('ইউজারনেম দিন।');
  if (!input.password || input.password.length < 4) throw new ValidationError('কমপক্ষে ৪ অক্ষরের পাসওয়ার্ড দিন।');

  const role = db
    .prepare('SELECT id FROM roles WHERE business_id = ? AND key = ?')
    .get(input.businessId, input.roleKey) as { id: string } | undefined;
  if (!role) throw new NotFoundError('ভূমিকা');

  const existing = db
    .prepare('SELECT id FROM users WHERE business_id = ? AND username = ?')
    .get(input.businessId, input.username.trim().toLowerCase());
  if (existing) throw new ConflictError('এই ইউজারনেমটি ব্যবহারে আছে।');

  const id = generateId();
  const salt = randomBytes(16).toString('hex');
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, business_id, name, username, password_hash, password_salt, pin, role_id, is_active, is_owner, must_change_password, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?)`
  ).run(
    id, input.businessId, input.name.trim(), input.username.trim().toLowerCase(),
    hashPassword(input.password, salt), salt, input.pin ?? null, role.id, now, now, input.userId ?? null
  );
  recordAudit(db, {
    businessId: input.businessId, userId: input.userId, action: 'user.create',
    entityType: 'user', entityId: id, after: { name: input.name, username: input.username, roleKey: input.roleKey }
  });
  return id;
}

export function updateUser(
  db: DB,
  input: {
    businessId: string;
    userId: string;
    name?: string;
    roleKey?: string;
    pin?: string | null;
    isActive?: boolean;
    adminUserId?: string;
  }
): void {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND business_id = ?').get(input.userId, input.businessId) as
    | Record<string, unknown>
    | undefined;
  if (!user) throw new NotFoundError('ব্যবহারকারী');
  if (user.is_owner === 1 && input.isActive === false) {
    throw new ConflictError('মালিক অ্যাকাউন্ট নিষ্ক্রিয় করা যায় না।');
  }
  if (user.is_owner === 1 && input.roleKey) {
    throw new ConflictError('মালিকের ভূমিকা পরিবর্তন করা যায় না।');
  }

  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [Date.now()];
  if (input.name !== undefined) sets.push('name = ?'), params.push(input.name.trim());
  if (input.roleKey !== undefined) {
    const role = db
      .prepare('SELECT id FROM roles WHERE business_id = ? AND key = ?')
      .get(input.businessId, input.roleKey) as { id: string } | undefined;
    if (!role) throw new NotFoundError('ভূমিকা');
    sets.push('role_id = ?');
    params.push(role.id);
  }
  if (input.pin !== undefined) sets.push('pin = ?'), params.push(input.pin);
  if (input.isActive !== undefined) sets.push('is_active = ?'), params.push(input.isActive ? 1 : 0);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, input.userId);
  recordAudit(db, {
    businessId: input.businessId, userId: input.adminUserId, action: 'user.update',
    entityType: 'user', entityId: input.userId, after: input
  });
}

export function changePassword(
  db: DB,
  input: { businessId: string; userId: string; newPassword: string; adminUserId?: string }
): void {
  if (!input.newPassword || input.newPassword.length < 4) {
    throw new ValidationError('কমপক্ষে ৪ অক্ষরের পাসওয়ার্ড দিন।');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND business_id = ?').get(input.userId, input.businessId) as
    | { id: string; password_salt: string }
    | undefined;
  if (!user) throw new NotFoundError('ব্যবহারকারী');
  const salt = randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(input.newPassword, salt), salt, Date.now(), input.userId);
  recordAudit(db, {
    businessId: input.businessId, userId: input.adminUserId ?? input.userId,
    action: 'user.password_change', entityType: 'user', entityId: input.userId
  });
}

export function requirePermission(user: AuthUser, permission: string): void {
  if (user.isOwner) return;
  if (!user.permissions.includes(permission)) {
    throw new UnauthorizedError('এই কাজটি করার অনুমতি নেই।');
  }
}

export function listRoles(db: DB, businessId: string) {
  return db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
       FROM roles r WHERE r.business_id = ? ORDER BY r.key`
    )
    .all(businessId) as Record<string, unknown>[];
}

export function getRolePermissions(db: DB, businessId: string, roleId: string): string[] {
  const role = db
    .prepare('SELECT id FROM roles WHERE id = ? AND business_id = ?')
    .get(roleId, businessId) as { id: string } | undefined;
  if (!role) throw new NotFoundError('ভূমিকা');
  return (db
    .prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
    .all(roleId) as { permission_key: string }[])
    .map((r) => r.permission_key);
}

export function setRolePermissions(db: DB, businessId: string, roleId: string, permissions: string[], userId?: string): void {
  const role = db
    .prepare('SELECT * FROM roles WHERE id = ? AND business_id = ?')
    .get(roleId, businessId) as
    | { id: string; business_id: string; key: string; is_system: number }
    | undefined;
  if (!role) throw new NotFoundError('ভূমিকা');
  if (role.key === 'owner') throw new ConflictError('মালিক ভূমিকার অনুমতি পরিবর্তন করা যায় না।');
  // Only keys from the shared catalog are accepted — arbitrary strings would
  // become dead permissions in the DB.
  const valid = new Set<string>(PERMISSIONS.map((p) => p.key));
  for (const p of permissions) {
    if (!valid.has(p)) throw new ValidationError(`অজানা অনুমতি: ${p}`);
  }
  tx(db, () => {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const ins = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const p of permissions) ins.run(roleId, p);
  });
  recordAudit(db, {
    businessId: role.business_id, userId, action: 'role.permissions_update',
    entityType: 'role', entityId: roleId, after: { count: permissions.length }
  });
}

export { ROLE_CATALOG, DEFAULT_ROLE_PERMISSIONS, RoleKey };
