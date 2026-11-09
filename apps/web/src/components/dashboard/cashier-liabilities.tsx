'use client';

import { useState } from 'react';

import { useConfirm } from '@/components/confirm';
import { Button, Card, Money } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { CashierShift } from '@/lib/types';

/**
 * DEP-05: shortfalls HQ rejected and put on a cashier. They stay on the cashier until a manager
 * closes the matter here - paid back, or waived - with a reason. Nothing moves in cash from this
 * panel; it records that the matter is closed.
 */
export function CashierLiabilities({ depotId }: { depotId: string }) {
  const { t } = useT();
  const { askReason } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const list = useAsync<CashierShift[]>(
    () => api.get(endpoints.cashierShifts.liabilities(depotId), true),
    [depotId],
  );
  const items = list.data ?? [];
  if (list.loading || list.error || items.length === 0) return null;

  async function settle(shift: CashierShift) {
    const note = await askReason({
      title: t('hrFix.cashierShift.settleTitle'),
      message: t('hrFix.cashierShift.settleBody', { name: shift.cashierName }),
      label: t('hrFix.cashierShift.settleReason'),
      confirmLabel: t('hrFix.cashierShift.settle'),
    });
    if (!note) return;
    setBusyId(shift.id);
    setError(null);
    try {
      await api.post(endpoints.cashierShifts.settleLiability(shift.id), { note }, true);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.cashierShift.settleError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-2 p-4" testId="cashier-liabilities">
      <p className="font-semibold">{t('hrFix.cashierShift.liabilitiesTitle')}</p>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((shift) => (
          <li key={shift.id} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {shift.cashierName}
              <span className="ml-2 text-muted">
                {shift.closedAt ? new Date(shift.closedAt).toLocaleDateString('id-ID') : ''}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <Money amount={shift.liabilityIdr ?? 0} className="font-semibold text-[color:var(--danger)]" />
              <Button variant="ghost" onClick={() => void settle(shift)} disabled={busyId === shift.id}>
                {t('hrFix.cashierShift.settle')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
