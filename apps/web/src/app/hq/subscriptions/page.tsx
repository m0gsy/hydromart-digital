'use client';

import { ArrowsClockwise } from '@phosphor-icons/react';

import { Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { SubscriptionNetworkSummary } from '@/lib/types';

// Design 18c — gallon subscriptions, now REAL (order-service subscriptions/admin/summary):
// active counts + per-plan breakdown. estMonthlyDeliveries is an estimate — order-service
// snapshots no subscription price, so a rupiah MRR is not derivable (labelled as such).
export default function HqSubscriptionsPage() {
  const { t } = useT();
  const { data, loading, error, reload } = useAsync<SubscriptionNetworkSummary>(
    () => api.get(endpoints.subscriptions.adminSummary, true),
  );

  const freqLabel = (f: string) => t(`hq.subscriptions.freq.${f}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ArrowsClockwise size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.subscriptions.title')}</h1>
          <p className="text-sm text-muted">{t('hq.subscriptions.subtitle')}</p>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <>
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
