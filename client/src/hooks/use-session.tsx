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

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<{ user: User; app: AppMeta; urlKey: string }>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  const user = me.data?.user ?? null;
  // Signed in: make sure the address carries this sign-in's key (after sign-in, or from an email link or old bookmark).
  const urlKey = me.data?.urlKey;
  useEffect(() => {
    if (urlKey && urlKey !== urlKeyInPath) moveToKey(urlKey);
  }, [urlKey]);
  const value: Session = {
    user,
    app: me.data?.app ?? null,
    loading: me.isPending,
    isStaff: isStaffRole(user?.role),
    isAdmin: user?.role === 'admin',
    setUser: (u) => qc.setQueryData(['me'], (prev: { user: User; app: AppMeta; urlKey: string } | null | undefined) => (prev ? { ...prev, user: u } : prev)),
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
