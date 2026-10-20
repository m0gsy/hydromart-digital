'use client';

import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';

import { getSessionLock, onSessionLockChange, type SessionLock } from '@/lib/token-store';

/**
 * The lock screen itself — its buttons, its icon, its copy — lives in a chunk of its own.
 *
 * This file is imported by `AuthProvider`, which is in the layout of EVERY page. Importing the
 * screen here pulled the whole `@/components/ui` barrel and an icon into that shared bundle, and
 * the Lighthouse ratchet failed `/driver` at +24 KB for a screen that is shown only when a stored
 * session is locked. The chunk is fetched the first time that happens (from the APK's own assets,
 * so it works offline) and never on the web.
 */
const LockScreen = lazy(() => import('./session-lock-screen'));

/** The live lock state of the stored session. Always `open` on the web. */
export function useSessionLock(): SessionLock {
  return useSyncExternalStore(onSessionLockChange, getSessionLock, () => 'pending');
}

/**
 * The way back from a session that is on the device but not open.
 *
 * Every screen is drawn from the cached profile, so without this a dismissed fingerprint
 * prompt left the whole app looking signed in while every request failed — and the only door
 * to the prompt was the login page, which nothing sent the user to. It covers the screen
 * wherever the user happens to be and offers exactly two ways out: open the session, or give
 * up on it and sign in with an SMS code. A shopper may also carry on as a guest (see
 * `session-lock-screen`).
 *
 * `onUnlocked` remounts what is underneath, so every screen that failed while the session was
 * shut loads again instead of staying on its error state.
 */
export function SessionLockGate({ onUnlocked }: { onUnlocked: () => void }) {
  const lock = useSessionLock();
  const [busy, setBusy] = useState(false);
  const [guest, setGuest] = useState(false);
  // A later unlock (from the login page) ends the guest visit.
  useEffect(() => {
    if (lock === 'open') setGuest(false);
  }, [lock]);
  // On the web, and on every launch that opens normally, this renders null and loads nothing.
  if ((lock !== 'locked' && !busy) || guest) return null;
  return (
    <Suspense fallback={null}>
      <LockScreen
        busy={busy}
        setBusy={setBusy}
        onUnlocked={onUnlocked}
        onGuest={() => setGuest(true)}
      />
    </Suspense>
  );
}
