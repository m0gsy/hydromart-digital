'use client';

import { DetailRow, DetailSheet } from '@/components/detail-sheet';
import { Money } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { CashSettlement } from '@/lib/types';

/**
 * One of the courier's own cash settlements.
 *
 * `GET /deliveries/api/v1/driver/settlement/:id` was left unwired because the courier
 * "reads their settlement HISTORY and submits a new one". The history row shows a status
 * and two totals; what it cannot show is WHY — the note a cashier wrote when they disputed
 * it, who verified it and when, and whether the shortfall was charged. That is the
 * courier's own money and the answer they would take to a manager.
 */
export function SettlementDetail({ settlementId }: { settlementId: string }) {
  const { t } = useT();
  return (
    <DetailSheet<CashSettlement>
      load={() => api.get<CashSettlement>(endpoints.deliveries.settlement.get(settlementId), true)}
      deps={[settlementId]}
      errorMessage={t('hrFix.settlementHistory.detailError')}
    >
      {(s) => (
        <div className="divide-y divide-[color:var(--border-soft)]">
          <DetailRow label={t('hrFix.settlementHistory.totalDue')}>
            <Money amount={s.expectedAmount} />
          </DetailRow>
          <DetailRow label={t('hrFix.settlementHistory.youHandedOver')}>
            <Money amount={s.depositedAmount} />
          </DetailRow>
          {/*
            Sign matters here more than anywhere: a negative variance is money the courier
            still owes. Rendering the absolute value would show a shortfall and a surplus
            as the same number.
          */}
          <DetailRow label={t('hrFix.settlementHistory.detailVariance')}>
            <span className={s.variance < 0 ? 'text-red-600' : 'text-[color:var(--success)]'}>
              {s.variance < 0 ? '−' : '+'}
              <Money amount={Math.abs(s.variance)} />
            </span>
          </DetailRow>
          <DetailRow label={t('hrFix.settlementHistory.detailCharged')}>
            {t(
              s.chargedToDriver
                ? 'hrFix.settlementHistory.detailChargedYes'
                : 'hrFix.settlementHistory.detailChargedNo',
            )}
          </DetailRow>
          <DetailRow label={t('hrFix.settlementHistory.detailOrders')}>
            {s.orderIds.length}
          </DetailRow>
          <DetailRow label={t('hrFix.settlementHistory.detailVerified')}>
            {s.verifiedAt ? formatDateTime(s.verifiedAt) : '—'}
          </DetailRow>
          {/*
            The note is the whole reason this screen exists — a DISPUTED settlement without
            the cashier's reason is a number the courier cannot argue with.
          */}
          {s.note && (
            <div className="py-2 text-sm">
              <div className="text-[color:var(--text-muted)]">
                {t('hrFix.settlementHistory.detailNote')}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap">{s.note}</p>
            </div>
          )}
        </div>
      )}
    </DetailSheet>
  );
}
