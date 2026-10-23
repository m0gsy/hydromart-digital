'use client';

import { Button, Card } from '@/components/ui';
import { itemCount, type HeldBasket } from '@/lib/held-baskets';
import { useT } from '@/lib/locale-context';

/**
 * Baskets set aside while a buyer fetches their money. Resuming is only offered while the
 * till is empty — loading one over a basket being rung up would silently throw that basket
 * away, and a cashier mid-queue has no time to notice.
 */
export function CounterHeldBaskets({
  held,
  canResume,
  onResume,
  onDiscard,
}: {
  held: readonly HeldBasket[];
  canResume: boolean;
  onResume: (basket: HeldBasket) => void;
  onDiscard: (id: string) => void;
}) {
  const { t, locale } = useT();
  if (held.length === 0) return null;
  const time = (at: number) =>
    new Date(at).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });
  return (
    <Card className="space-y-2 p-3" testId="counter-held">
      <span className="text-sm font-bold">{t('opsFix.walkIn.heldTitle')}</span>
      {!canResume && (
        <p className="text-[11.5px] text-muted">{t('opsFix.walkIn.heldResumeBlocked')}</p>
      )}
      <ul className="divide-y divide-[color:var(--border)]">
        {held.map((b) => {
          const who = b.name.trim() || b.phone.trim() || t('opsFix.walkIn.heldWhoFallback');
          return (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm">
                {t('opsFix.walkIn.heldLine', {
                  who,
                  count: itemCount(b),
                  time: time(b.savedAt),
                })}
              </span>
              <span className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={!canResume}
                  aria-label={`${t('opsFix.walkIn.heldResume')} — ${who}`}
                  onClick={() => onResume(b)}
                >
                  {t('opsFix.walkIn.heldResume')}
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`${t('opsFix.walkIn.heldDiscard')} — ${who}`}
                  onClick={() => onDiscard(b.id)}
                >
                  {t('opsFix.walkIn.heldDiscard')}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
