'use client';

import { useMemo } from 'react';
import { TrendUp } from '@phosphor-icons/react';

import { BarTrend, CohortGrid } from '@/components/hq/charts';
import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { CATEGORY_REVENUE_STUB, RETENTION_COHORT_STUB, StubBadge } from '@/lib/hq/stubs';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ExecutiveDashboard } from '@/lib/types';

// Trailing-6-month window, computed once per mount (client-only).
function sixMonthRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 182 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Design 22b — network analytics. Revenue trend is real (executive sales buckets); the
// category breakdown and retention cohort have no endpoint → sample data, badged.
export default function HqAnalyticsPage() {
  const { t } = useT();
  const range = useMemo(sixMonthRange, []);
  const dash = useAsync<ExecutiveDashboard>(() => api.get(endpoints.dashboard.executive(range), true));

  if (dash.loading) return <Skeleton className="h-96 w-full" />;
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />;

  const buckets = dash.data?.sales?.buckets ?? [];
  const trend = buckets.map((b) => ({ label: b.period, value: b.revenue }));
  const categoryMax = Math.max(1, ...CATEGORY_REVENUE_STUB.map((c) => c.revenue));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <TrendUp size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.analytics.title')}</h1>
          <p className="text-sm text-muted">{t('hq.analytics.subtitle')}</p>
        </div>
      </div>

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
        {/* Revenue by category — STUB */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            {t('hq.analytics.byCategory')}
            <StubBadge />
          </h2>
          <ul className="flex flex-col gap-3">
            {CATEGORY_REVENUE_STUB.map((c) => (
              <li key={c.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{c.label}</span>
                  <Money amount={c.revenue} className="shrink-0 text-xs text-muted" />
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                  <div
                    className="h-full rounded-full bg-brand-600"
                    style={{ width: `${Math.round((c.revenue / categoryMax) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* Retention cohort — STUB */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            {t('hq.analytics.cohort')}
            <StubBadge />
          </h2>
          <p className="text-xs text-muted">{t('hq.analytics.cohortHint')}</p>
          <CohortGrid rows={RETENTION_COHORT_STUB} />
        </Card>
      </div>
    </div>
  );
}
