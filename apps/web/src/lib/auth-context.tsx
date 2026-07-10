'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { endpoints } from './endpoints';
import { getSession, setSession, subscribe } from './session-store';
import type { Customer, Session } from './types';

interface AuthValue {
  session: Session | null;
  customer: Customer | null;
  ready: boolean;
  signIn: (session: Session) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setLocal] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLocal(getSession());
    const unsub = subscribe(setLocal);

    // Validate a persisted token and refresh the customer snapshot.
    const current = getSession();
    if (current) {
      api
        .get<Customer>(endpoints.auth.me, true)
        .then((customer) => setSession({ ...getSession()!, customer }))
        .catch(() => {
          /* refresh-and-retry lives in the client; a hard 401 clears the session */
        })
        .finally(() => setReady(true));
    } else {
      setReady(true);
    }
    return unsub;
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      customer: session?.customer ?? null,
      ready,
      signIn: (s) => setSession(s),
      signOut: () => {
        const refreshToken = getSession()?.refreshToken;
        if (refreshToken) api.post(endpoints.auth.logout, { refreshToken }, true).catch(() => {});
        setSession(null);
      },
    }),
    [session, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
