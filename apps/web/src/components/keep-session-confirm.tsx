'use client';

import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui';
import { useT } from '@/lib/locale-context';

/**
 * Asked before an SMS code is spent while the Keystore still holds a session that opens with
 * a fingerprint or PIN. Inline, not `useConfirm`: the lock screen renders above `ConfirmProvider`.
 *
 * Both buttons are `type="button"`: on the login pages this renders inside the phone-number
 * `<form>`, where a bare `<button>` is a submit button, and every click would also post the
 * form — "Buka sesi" would send the very SMS it exists to avoid.
 */
export function KeepSessionConfirm({
  busy,
  onOpen,
  onSkip,
}: {
  busy?: boolean;
  onOpen: () => void;
  onSkip: () => void;
}) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  // The button that opened this unmounts as it appears, which drops focus to <body>; put it on
  // the safe choice so a keyboard or TalkBack user lands inside the question, not above it.
  useEffect(() => box.current?.querySelector('button')?.focus(), []);
  return (
    <div
      ref={box}
      role="group"
      aria-label={t('auth.keepSession.title')}
      className="flex w-full max-w-[360px] flex-col gap-2 rounded-[14px] border border-app bg-[color:var(--surface-elevated)] p-4 text-left"
    >
      <p className="text-[14px] font-semibold">{t('auth.keepSession.title')}</p>
      <p className="text-[13px] text-muted">{t('auth.keepSession.body')}</p>
      <Button type="button" onClick={onOpen} loading={busy}>
        {t('auth.keepSession.open')}
      </Button>
      <Button type="button" variant="secondary" onClick={onSkip} disabled={busy}>
        {t('auth.keepSession.skip')}
      </Button>
    </div>
  );
}
