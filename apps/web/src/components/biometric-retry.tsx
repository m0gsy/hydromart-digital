'use client';

import { useState } from 'react';
import { Fingerprint } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import { hasTokens, retryUnlock, unlockWasCancelled } from '@/lib/token-store';

/**
 * The way back from a dismissed unlock prompt.
 *
 * The stored session survives a dismissal on purpose — a stray back-press is not evidence
 * of anything. But the unlock is remembered for the life of the process, so until now the
 * only way to ask again was to kill the app, and the user was shown a login screen that
 * wanted an OTP for a session sitting perfectly intact in the Keystore.
 *
 * Renders nothing unless that is exactly what happened, which on the web is never.
 * `unlockWasCancelled()` is read at render rather than subscribed to: this screen is only
 * reached after the unlock has already settled.
 */
export function BiometricRetry() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!unlockWasCancelled()) return null;

  async function unlock() {
    setBusy(true);
    setFailed(false);
    await retryUnlock();
    if (hasTokens()) {
      // A document load rather than a router push: every provider above this screen decided
      // the user was signed out on the way in, and re-deciding that from here would mean
      // teaching each of them a second entry point.
      //
      // Home, not `reload()`. This screen only ever renders on `/login`, and in an exported
      // build a reload there asks the WebView for `/login/` — whose Capacitor SPA fallback
      // answers with the HOME document while the URL keeps saying `/login/`. React then
      // hydrates home markup against the login route, throws the tree away (#418) and
      // rebuilds the whole root, which also wipes the plugin's safe-area insets off <html>.
      // The user has just proved they have a session, so home is where they were going.
      window.location.replace('/');
      return;
    }
    setBusy(false);
    setFailed(true);
  }

  return (
    <div className="flex w-full max-w-[360px] flex-col gap-2 rounded-[14px] border border-app bg-[color:var(--surface-elevated)] p-4">
      <p className="text-[13px] text-muted">
        {t('auth.login.biometricHint')}
      </p>
      <Button
        variant="secondary"
        onClick={unlock}
        loading={busy}
        className="flex items-center justify-center gap-2"
      >
        <Fingerprint size={18} weight="fill" />
        Buka sesi tersimpan
      </Button>
      {failed && (
        <p role="alert" className="text-[12.5px] text-[color:var(--danger)]">
          {t('auth.login.biometricFailed')}
        </p>
      )}
    </div>
  );
}
