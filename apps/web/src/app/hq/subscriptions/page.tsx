'use client';

import { ArrowsClockwise } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { SubscriptionNetworkSummary } from '@/lib/types';

// Design 18c — gallon subscriptions, now REAL: active counts + per-plan breakdown.
// estMonthlyDeliveries is an estimate — order-service snapshots no subscription price, so a
// rupiah MRR is not derivable (labelled as such).
//
// K1.11: this screen used to read ONE of the two subscription systems — order-service's
// customer-created plans — and label the answer as the network's. Depot-created
// subscriptions live in depot-service and were only ever listable one depot at a time, so
// every one of them was silently missing from a number an operator plans against. Both
// halves are read now, each labelled for what it actually counts, with a line saying they
// are two populations and not one. Adding them together would be a third wrong number.
export default function HqSubscriptionsPage() {
  const { t } = useT();
  const { data, loading, error, reload } = useAsync<SubscriptionNetworkSummary>(
    () => api.get(endpoints.subscriptions.adminSummary, true),
  );
  // Read separately, and allowed to fail separately: a depot-service outage must not blank
  // the customer figures this screen could always show.
  const depotSubs = useAsync<{ activeSubscriptions: number; activeSubscribers: number }>(
    () => api.get(endpoints.depotSubscriptions.adminSummary, true),
  );

  const freqLabel = (f: string) => t(`hq.subscriptions.freq.${f}`);

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={ArrowsClockwise} title={t('hq.subscriptions.title')} subtitle={t('hq.subscriptions.subtitle')} />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <>
          <p className="text-xs text-muted">{t('hq.subscriptions.twoSystems')}</p>

          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('hq.subscriptions.activeSubs')}</p>
              <p className="text-2xl font-bold tabular-nums">
                {(data?.activeSubscriptions ?? 0).toLocaleString('id-ID')}
              </p>
            </Card>
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('hq.subscriptions.subscribers')}</p>
              <p className="text-2xl font-bold tabular-nums">
                {(data?.activeSubscribers ?? 0).toLocaleString('id-ID')}
              </p>
            </Card>
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('hq.subscriptions.estDeliveries')}</p>
              <p className="text-2xl font-bold tabular-nums">
                ≈ {(data?.estMonthlyDeliveries ?? 0).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-muted">{t('hq.subscriptions.estHint')}</p>
            </Card>
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('hq.subscriptions.depotSubs')}</p>
              <p className="text-2xl font-bold tabular-nums">
                {/* A dash, not a zero: unread is not none, and this whole item exists
                    because a missing population was rendered as an answer. */}
                {depotSubs.error
                  ? '—'
                  : (depotSubs.data?.activeSubscriptions ?? 0).toLocaleString('id-ID')}
              </p>
              {depotSubs.error && (
                <p className="text-[11px] text-muted">{t('hq.subscriptions.depotUnreadable')}</p>
              )}
            </Card>
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('hq.subscriptions.depotSubscribers')}</p>
              <p className="text-2xl font-bold tabular-nums">
                {depotSubs.error
                  ? '—'
                  : (depotSubs.data?.activeSubscribers ?? 0).toLocaleString('id-ID')}
              </p>
            </Card>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">{t('hq.subscriptions.product')}</th>
                  <th className="px-4 py-3 font-medium">{t('hq.subscriptions.frequency')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('hq.subscriptions.subscribers')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {(data?.plans ?? []).map((p, i) => (
                  <tr key={`${p.productName}-${p.frequency}-${i}`}>
                    <td className="px-4 py-3 font-medium">{p.productName}</td>
                    <td className="px-4 py-3 text-muted">{freqLabel(p.frequency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {t('hq.subscriptions.subscriberCount', { n: p.subscribers })}
                    </td>
                  </tr>
                ))}
                {(data?.plans.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-muted">
                      {t('hq.subscriptions.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
