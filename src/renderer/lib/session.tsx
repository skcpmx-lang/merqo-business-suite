/** Session state: login result in memory + localStorage persistence.
 *  The token is the only credential; all authority is re-checked in main. */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { LoginResult } from '@shared/ipc';
import { api, errMsg } from './api';

interface SessionState {
  user: LoginResult | null;
  business: { id: string; name: string } | null;
  ready: boolean;
  login: (businessId: string, username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

const LS_KEY = 'merqo.session.v1';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<LoginResult | null>(null);
  const [business, setBusiness] = useState<{ id: string; name: string } | null>(null);
  const [ready, setReady] = useState(false);

  const restore = useCallback(async () => {
    try {
      const status = await api.auth.status();
      setBusiness(status.business);
      const saved = localStorage.getItem(LS_KEY);
      if (saved && status.business) {
        const parsed = JSON.parse(saved) as LoginResult;
        if (parsed.token && parsed.businessId === status.business.id) {
          const me = await api.auth.me(parsed.token);
          if (me) {
            setUser({ ...me, token: parsed.token });
          }
        }
      }
    } catch {
      // status failed — stay on login
    } finally {
      setReady(true);
    }
  }, []);

  const login = useCallback(
    async (businessId: string, username: string, password: string) => {
      const res = await api.auth.login({ businessId, username, password });
      setUser(res);
      setBusiness({ id: res.businessId, name: (await api.auth.status()).business?.name ?? '' });
      localStorage.setItem(LS_KEY, JSON.stringify(res));
      return res;
    },
    []
  );

  const logout = useCallback(async () => {
    if (user) {
      try {
        await api.auth.logout(user.token);
      } catch {
        // session may already be invalid
      }
    }
    localStorage.removeItem(LS_KEY);
    setUser(null);
  }, [user]);

  const can = useCallback(
    (perm: string) => !!user && (user.isOwner || user.permissions.includes(perm)),
    [user]
  );

  const value = useMemo<SessionState>(
    () => ({ user, business, ready, login, logout, can, refresh: restore }),
    [user, business, ready, login, logout, can, restore]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}

export { errMsg };
