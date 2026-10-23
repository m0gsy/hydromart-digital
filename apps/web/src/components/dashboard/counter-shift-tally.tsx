'use client';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { CounterShiftSummary } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

/**
 * What the cashier has rung up since the shift opened: a count and a value, nothing else.
 *
 * Deliberately not the drawer. The close counts cash blind — the cashier enters what they
 * counted and the server knows what should be there — so this carries no cash figure and no
 * "should be in the till". `refreshKey` changes after each sale or void so the tally follows
 * without a poll. Shows nothing while loading or if it cannot be read: a courtesy line must
 * never get in the way of selling.
 */
export function CounterShiftTally({
  depotId,
  openedAt,
  refreshKey,
}: {
  depotId: string;
  openedAt: string;
  refreshKey: number;
}) {
  const { t } = useT();
  const tally = useAsync<CounterShiftSummary>(
    () => api.get(endpoints.orders.walkInShiftSummary(depotId, openedAt), true),
    [depotId, openedAt, refreshKey],
  );
  if (!tally.data) return null;
  return (
    <p className="text-sm text-muted" data-testid="counter-shift-tally">
      {t('opsFix.walkIn.shiftTally', {
        count: tally.data.orderCount,
        amount: formatIDR(tally.data.revenueIdr),
      })}
    </p>
  );
}
