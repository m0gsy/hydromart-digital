'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Fingerprint } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { setSession } from '@/lib/session-store';
import {
  clearTokens,
  getSessionLock,
  hasTokens,
  onSessionLockChange,
  retryUnlock,
  type SessionLock,
} from '@/lib/token-store';

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
 * up on it and sign in with an SMS code.
 *
 * A shopper may also carry on as a guest: the catalogue never needed a sign-in, and a customer who
 * dismisses the prompt should not lose it. That drops the cached profile for this launch and
 * leaves the stored session alone, so the login page still offers to open it. Staff are not
 * offered this — every screen they use needs the session.
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
  // Split from the screen so that nothing below — copy, buttons — is needed until a session is
  // actually locked. On the web, and on every launch that opens normally, this renders null.
  if ((lock !== 'locked' && !busy) || guest) return null;
  return (
    <LockScreen busy={busy} setBusy={setBusy} onUnlocked={onUnlocked} onGuest={() => setGuest(true)} />
  );
}

function LockScreen({
  busy,
  setBusy,
  onUnlocked,
  onGuest,
}: {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onUnlocked: () => void;
  onGuest: () => void;
}) {
  const { t } = useT();
  const { customer } = useAuth();
  const [failed, setFailed] = useState(false);
  // No cached profile means nothing to hide; a CUSTOMER profile means a shopper.
  const canBrowse = !customer || customer.role === 'CUSTOMER';

  async function unlock() {
    setBusy(true);
    setFailed(false);
    try {
      await retryUnlock();
    } finally {
      setBusy(false);
    }
    if (hasTokens()) {
      api.invalidate();
      onUnlocked();
    } else {
      setFailed(true);
    }
  }

  function signInWithSms() {
    // Local only: the token that could revoke the old session upstream is exactly the one
    // that cannot be read. The next sign-in replaces it.
    clearTokens();
    setSession(null);
  }

  function continueAsGuest() {
    // The profile goes, the Keystore entry stays: `login` still offers "Buka sesi tersimpan".
    setSession(null);
    onGuest();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-lock-title"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[color:var(--surface-muted)] px-6 text-center"
    >
      <Fingerprint size={44} weight="fill" className="text-brand-500" />
      <h2 id="session-lock-title" className="text-lg font-semibold">
        {t('auth.lock.title')}
      </h2>
      <p className="max-w-sm text-sm text-muted">{t('auth.lock.body')}</p>
      <div className="flex w-full max-w-[360px] flex-col gap-2">
        <Button onClick={unlock} loading={busy}>
          {t('auth.lock.unlock')}
        </Button>
        <Button variant="secondary" onClick={signInWithSms} disabled={busy}>
          {t('auth.lock.useOtp')}
        </Button>
        {canBrowse && (
          <Button variant="ghost" onClick={continueAsGuest} disabled={busy}>
            {t('auth.lock.continueGuest')}
          </Button>
        )}
      </div>
      {failed && (
        <p role="alert" className="text-[12.5px] text-[color:var(--danger)]">
          {t('auth.lock.failed')}
        </p>
      )}
    </div>
  );
}
