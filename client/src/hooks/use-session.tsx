import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { isStaffRole } from '@/lib/format';
import type { AppMeta, User } from '@/lib/types';
import { moveToKey, urlKeyInPath } from '@/lib/url-key';

interface Session {
  user: User | null;
  app: AppMeta | null;
  loading: boolean;
  isStaff: boolean;
  isAdmin: boolean;
  setUser: (user: User) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const SessionContext = createContext<Session | null>(null);

type MeData = { user: User; app: AppMeta; urlKey: string };

// After sign-in the page reloads onto the sign-in's address (/<key>/...). The session details travel across that
// reload so the new page opens without asking the server again. Only for a few seconds, and only for that key.
const SEED_KEY = 'session-seed';
function saveSeed(data: MeData) {
  try {
    sessionStorage.setItem(SEED_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Storage may be unavailable; the new page then asks the server as usual.
  }
}
function takeSeed(): MeData | undefined {
  try {
    const raw = sessionStorage.getItem(SEED_KEY);
    sessionStorage.removeItem(SEED_KEY);
    const seed = raw ? JSON.parse(raw) : null;
    return seed && Date.now() - seed.at < 30_000 && seed.data?.urlKey === urlKeyInPath ? seed.data : undefined;
  } catch {
    return undefined;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<MeData>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    initialData: takeSeed,
    staleTime: Infinity,
    // Ask again if the connection dropped; any answer from the server stands.
    retry: (count, err) => err instanceof ApiError && err.status === 0 && count < 2,
  });

  const user = me.data?.user ?? null;
  // Signed in: make sure the address carries this sign-in's key (after sign-in, or from an email link or old bookmark).
  const urlKey = me.data?.urlKey;
  useEffect(() => {
    if (urlKey && urlKey !== urlKeyInPath && me.data) {
      saveSeed(me.data);
      moveToKey(urlKey);
    }
  }, [urlKey, me.data]);
  const value: Session = {
    user,
    app: me.data?.app ?? null,
    loading: me.isPending,
    isStaff: isStaffRole(user?.role),
    isAdmin: user?.role === 'admin',
    setUser: (u) => qc.setQueryData(['me'], (prev: MeData | null | undefined) => (prev ? { ...prev, user: u } : prev)),
    signOut: async () => {
      await api.post('/auth/logout').catch(() => {});
      qc.clear();
      window.location.href = '/login';
    },
    refresh: () => me.refetch(),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
