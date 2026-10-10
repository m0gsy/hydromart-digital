'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { api } from './api';
import { onDepotChanged, refreshNow } from './depot-signal';
import { reconcileDepot } from './depot-follow';
import { setDepot } from './depot-store';
import { endpoints } from './endpoints';
import { unsubscribeFromPush } from './push';
import { forgetNotificationsSeen } from './unread';
import { setLocation } from './location-store';
import { forgetSessionFamily, rememberSessionFamily } from './session-device';
import { getSession, setSession, subscribe } from './session-store';
import { clearTokens, getRefreshToken, hasTokens, unlockTokens } from './token-store';
import type { Customer, Session } from './types';

interface AuthValue {
  session: Session | null;
  customer: Customer | null;
  ready: boolean;
  signIn: (session: Session) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

/** At most one background re-check of the account per minute. */
const REVALIDATE_MIN_MS = 60_000;

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
    // F3b: nothing may ask the API anything until the Keystore has been unlocked and the
    // token store knows whether this launch has a session. Resolves immediately on the
    // web, and on native when the device lock has been answered one way or the other —
    // so the biometric prompt is the first thing a returning user sees, and the first
    // request goes out with the bearer already attached instead of 401ing into a
    // sign-out.
    let cancelled = false;

    /*
     * Re-ask the server who this account is, and follow it if it has moved depot.
     *
     * The login's depot changes server-side (an employee lent to another depot flips within
     * a quarter hour of midnight), but this client only read `/auth/me` once, at mount - so a
     * phone left open kept scoping every screen, and every request, to the depot the person
     * had already left. Now it re-asks when the app comes back to the foreground, and when a
     * self-service response says the token is out of date. Rate-limited: a flapping focus
     * event must not become a request storm against a rate-limited gateway.
     */
    let lastCheck = 0;
    const revalidate = async (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastCheck < REVALIDATE_MIN_MS) return;
      if (!getSession() && !hasTokens()) return;
      lastCheck = now;
      try {
        const before = getSession()?.customer?.assignedDepotId ?? null;
        const customer = await api.get<Customer>(endpoints.auth.me, true);
        const after = customer.assignedDepotId ?? null;
        // The token carries the depot too: take a fresh one so requests stop being scoped to
        // the old depot, not only the screens.
        if (before !== null && after !== before) await refreshNow();
        if (!cancelled) setSession({ customer });
        reconcileDepot(customer);
      } catch {
        /* a transient failure changes nothing; the next focus tries again */
      }
    };
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void revalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    onDepotChanged(() => void revalidate(true));

    void unlockTokens().then(() => {
      if (cancelled) return;
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
    });
    return () => {
      cancelled = true;
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      onDepotChanged(null);
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      customer: session?.customer ?? null,
      ready,
      signIn: (s) => {
        // CA-3-57: remember which rotation family this device is, so the devices list can
        // mark the row the person is actually holding.
        rememberSessionFamily(s.familyId);
        setSession(s);
      },
      signOut: () => {
        // Gateway reads the refresh cookie and clears both session cookies; body-less.
        // Native has no cookie to be read, so it hands the refresh token over — without
        // it the upstream revoke is skipped and the token stays valid for its full 30
        // days on a phone whose user just signed out.
        const refreshToken = getRefreshToken();
        api
          .post(endpoints.auth.logout, refreshToken ? { refreshToken } : undefined, true)
          .catch(() => {});
        // F5: release the FCM registration too, and issue it here — before `clearTokens()`
        // — for the same reason the logout call is issued here: the DELETE needs the bearer
        // that is about to be dropped. Without it the device kept receiving the previous
        // account's pushes, and the NEXT account was never registered either: the endpoint
        // is the same `fcm:<token>` string, so the sync deduped against a registration that
        // now belonged to somebody else. Fire-and-forget — a failed release must never stop
        // somebody signing out, and the server-side row is replaced on the next subscribe.
        void unsubscribeFromPush().catch(() => {});
        /*
         * CA-3-56 / CA-3-59 — two things that belong to the PERSON and were stored against
         * the DEVICE, and so survived them leaving.
         *
         * The notifications "last seen" timestamp: the next account signed in on the same
         * handset found every row already older than the previous person's last visit —
         * their notifications existed and the badge said nothing.
         *
         * The delivery location: a lat/lng and a place name, kept in localStorage so it
         * survives reloads. It also survived sign-out, so the next person to open the app
         * on that phone was shown, and would have ordered to, where the last one lives.
         * It is a location, and it stayed behind on a device its owner had walked away
         * from.
         */
        forgetNotificationsSeen();
        forgetSessionFamily();
        setLocation(null);
        // The depot picked in the console is the PERSON's, not the phone's: the next account to
        // sign in here must not inherit it (it was a depot their own token is refused for).
        setDepot(null);
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
