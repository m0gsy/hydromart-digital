'use client';

import { Button } from '@/components/ui';
import { useT } from '@/lib/locale-context';

/**
 * Asked before an SMS code is spent while the Keystore still holds a session that opens with
 * a fingerprint or PIN. Inline, not `useConfirm`: the lock screen renders above `ConfirmProvider`.
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
  return (
    <div
      role="group"
      aria-label={t('auth.keepSession.title')}
      className="flex w-full max-w-[360px] flex-col gap-2 rounded-[14px] border border-app bg-[color:var(--surface-elevated)] p-4 text-left"
    >
      <p className="text-[14px] font-semibold">{t('auth.keepSession.title')}</p>
      <p className="text-[13px] text-muted">{t('auth.keepSession.body')}</p>
      <Button onClick={onOpen} loading={busy}>
        {t('auth.keepSession.open')}
      </Button>
      <Button variant="secondary" onClick={onSkip} disabled={busy}>
        {t('auth.keepSession.skip')}
      </Button>
    </div>
  );
}
