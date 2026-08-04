'use client';

import { useMemo } from 'react';
import { TrendUp } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { BarTrend, CohortGrid } from '@/components/hq/charts';
import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ExecutiveDashboard, RetentionCohort, RevenueByProduct } from '@/lib/types';

// Trailing-6-month window, computed once per mount (client-only).
function sixMonthRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 182 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Design 22b — network analytics, all REAL (order-service reports). Revenue trend =
// executive sales buckets; the breakdown is per-PRODUCT (order-service snapshots no
// category); retention = first-order-month cohorts.
export default function HqAnalyticsPage() {
  const { t } = useT();
  const range = useMemo(sixMonthRange, []);
  const dash = useAsync<ExecutiveDashboard>(() => api.get(endpoints.dashboard.executive(range), true));
  const byProduct = useAsync<RevenueByProduct>(
    () => api.get(endpoints.reports.revenueByCategory({ ...range, limit: 8 }), true),
  );
  const cohort = useAsync<RetentionCohort>(
    () => api.get(endpoints.reports.retentionCohort(range), true),
  );

  if (dash.loading) return <Skeleton className="h-96 w-full" />;
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />;

  const buckets = dash.data?.sales?.buckets ?? [];
  const trend = buckets.map((b) => ({ label: b.period, value: b.revenue }));
  const products = byProduct.data?.items ?? [];
  const productMax = Math.max(1, ...products.map((c) => c.revenue));

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={TrendUp} title={t('hq.analytics.title')} subtitle={t('hq.analytics.subtitle')} />

      {/* Revenue trend — REAL */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">{t('hq.analytics.revenueTrend')}</h2>
        {trend.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">{t('hq.analytics.noTrend')}</p>
        ) : (
          <BarTrend data={trend} />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue by product — REAL (per-product, not category) */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-semibold">{t('hq.analytics.byProduct')}</h2>
          <p className="text-xs text-muted">{t('hq.analytics.byProductHint')}</p>
          {byProduct.loading ? (
            <Skeleton className="h-40 w-full" />
          ) : byProduct.error ? (
            <ErrorState message={byProduct.error} onRetry={byProduct.reload} />
          ) : products.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">{t('hq.analytics.noProduct')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {products.map((c) => (
                <li key={c.productId} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium">{c.productName}</span>
                    <span className="flex shrink-0 items-baseline gap-2 text-xs text-muted">
                      <span className="tabular-nums">{Math.round(c.share * 100)}%</span>
                      <Money amount={c.revenue} />
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                    <div
                      className="h-full rounded-full bg-brand-600"
                      style={{ width: `${Math.round((c.revenue / productMax) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Retention cohort — REAL */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-semibold">{t('hq.analytics.cohort')}</h2>
          <p className="text-xs text-muted">{t('hq.analytics.cohortHint')}</p>
          {cohort.loading ? (
            <Skeleton className="h-40 w-full" />
          ) : cohort.error ? (
            <ErrorState message={cohort.error} onRetry={cohort.reload} />
          ) : (cohort.data?.rows.length ?? 0) === 0 ? (
            <p className="py-4 text-center text-sm text-muted">{t('hq.analytics.noCohort')}</p>
          ) : (
            <CohortGrid rows={cohort.data!.rows} />
          )}
        </Card>
      </div>
    </div>
  );
}
