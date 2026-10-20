'use client';

import { useState } from 'react';
import { Fingerprint } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { setSession } from '@/lib/session-store';
import { clearTokens, hasTokens, retryUnlock } from '@/lib/token-store';

/**
 * The screen over a locked session. Loaded lazily by `SessionLockGate` — keep it out of anything
 * the layout imports, or every page pays for it (see the note there).
 *
 * A shopper may carry on as a guest: the catalogue never needed a sign-in, and a customer who
 * dismisses the prompt should not lose it. That drops the cached profile for this launch and leaves
 * the stored session alone, so the login page still offers to open it. Staff are not offered this —
 * every screen they use needs the session.
 */
export default function LockScreen({
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
