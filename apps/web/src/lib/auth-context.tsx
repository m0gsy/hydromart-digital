'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { endpoints } from './endpoints';
import { getSession, setSession, subscribe } from './session-store';
import { clearTokens, getRefreshToken, hasTokens } from './token-store';
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
    //
    // F2: `hasTokens()` is the second door, and on native it is the one that matters.
    // The cached profile is a UX convenience in localStorage, which Android evicts on its
    // own schedule; the token store outlives it. Checking only the profile logs a user
    // out of a live 30-day session because a cache was cleared — so a client holding a
    // token revalidates and rebuilds the profile from `/auth/me` instead.
    if (getSession() || hasTokens()) {
      api
        .get<Customer>(endpoints.auth.me, true)
        .then((customer) => setSession({ customer }))
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
        // Gateway reads the refresh cookie and clears both session cookies; body-less.
        // Native has no cookie to be read, so it hands the refresh token over — without
        // it the upstream revoke is skipped and the token stays valid for its full 30
        // days on a phone whose user just signed out.
        const refreshToken = getRefreshToken();
        api
          .post(endpoints.auth.logout, refreshToken ? { refreshToken } : undefined, true)
          .catch(() => {});
        // Safe on this line: the request above has already been issued with its bearer
        // attached — `api` builds headers before it awaits anything.
        clearTokens();
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
