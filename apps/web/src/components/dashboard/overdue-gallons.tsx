'use client';

import { Warning } from '@phosphor-icons/react';

import { Badge } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/locale-context';

/**
 * How many of a customer's gallons are past the depot's loan limit.
 *
 * `null` (the ledger — or an older depot-service — did not say) and `0` (nothing is late)
 * both render NOTHING, on purpose: a badge is a claim, and the only honest claim available
 * from "unknown" is silence. The cell beside it already says "belum tersambung" when the
 * whole ledger is unreadable.
 *
 * `badge` is the directory row; `line` is the sentence on the customer card.
 */
export function OverdueGallons({
  overdue,
  oldestAt,
  variant,
}: {
  overdue: number | null;
  oldestAt: string | null;
  variant: 'badge' | 'line';
}) {
  const { t } = useT();
  if (!overdue || overdue <= 0) return null;
  const date = oldestAt ? formatDate(oldestAt) : '';

  if (variant === 'line') {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        <Warning size={18} weight="fill" className="mt-0.5 shrink-0" />
        {t('dashA.customerDetail.overdueLine', { n: overdue, date })}
      </p>
    );
  }

  return (
    <span title={oldestAt ? t('dashA.customers.overdueSince', { date }) : undefined}>
      <Badge tone="danger">{t('dashA.customers.overdueBadge', { n: overdue })}</Badge>
    </span>
  );
}
