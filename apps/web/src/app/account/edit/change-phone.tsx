'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';

/**
 * K1.4 — the number was the login identity and the one thing nobody could change.
 *
 * Two steps, because moving an identity on one request is the same shape as stealing one.
 * The second step sends only the code: the destination lives on the server's stored
 * challenge, so a code proving control of one number can never move the account onto
 * another. This screen never sends the new number twice, and that is on purpose.
 *
 * On success the server revokes every session, including this one. So the last thing this
 * does is sign out locally — the alternative is a screen holding a token the server has
 * already thrown away, which fails on the next request with nothing to explain it.
 */
export function ChangePhone({ currentPhone }: { currentPhone: string }) {
  const { t } = useT();
  const { toast } = useToast();
  const { signOut } = useAuth();

  const [open, setOpen] = useState(false);
  /** Null until a code has been sent; then the masked destination the server reports. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setSentTo(null);
    setPhone('');
    setCode('');
    setError(null);
  }

  async function sendCode() {
    if (!phone.trim()) {
      setError(t('hrFix.accountEdit.newPhoneRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const challenge = await api.post<{ phoneMasked: string }>(
        endpoints.auth.requestPhoneChange,
        { phone: phone.trim() },
        true,
      );
      setSentTo(challenge.phoneMasked);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.accountEdit.sendFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!code.trim()) {
      setError(t('hrFix.accountEdit.codeRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Only the code. The number is not sent again — see the note above.
      await api.post(endpoints.auth.confirmPhoneChange, { code: code.trim() }, true);
      toast(t('hrFix.accountEdit.changed'), 'success');
      signOut();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.accountEdit.confirmFailed'));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Field label={t('hrFix.accountEdit.phone')} hint={t('hrFix.accountEdit.phoneIsLogin')}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-semibold">{currentPhone}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[12.5px] font-bold text-brand-700 hover:text-brand-800"
          >
            {t('hrFix.accountEdit.changePhone')}
          </button>
        </div>
      </Field>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-app p-3">
      {sentTo === null ? (
        <Field
          label={t('hrFix.accountEdit.newPhone')}
          htmlFor="change-phone-new"
          hint={t('hrFix.accountEdit.phoneIsLogin')}
          error={error ?? undefined}
        >
          <Input
            id="change-phone-new"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
      ) : (
        <Field
          label={t('hrFix.accountEdit.code')}
          htmlFor="change-phone-code"
          hint={t('hrFix.accountEdit.codeSentTo', { phone: sentTo })}
          error={error ?? undefined}
        >
          <Input
            id="change-phone-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
      )}
      <div className="flex gap-2">
        <Button type="button" loading={busy} onClick={sentTo === null ? sendCode : confirm}>
          {sentTo === null
            ? t('hrFix.accountEdit.sendCode')
            : t('hrFix.accountEdit.confirmChange')}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={reset}>
          {t('hrFix.accountEdit.cancelChange')}
        </Button>
      </div>
    </div>
  );
}
