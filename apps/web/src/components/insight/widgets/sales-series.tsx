'use client';

import { useMemo } from 'react';

import { MultiLine } from '@/components/hq/charts';
import type { InsightCtx } from '@/components/insight/context';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { periodLabel } from '@/lib/insight/label';
import { granularityFor, regroup } from '@/lib/insight/range';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { SalesReport } from '@/lib/types';

/**
 * Revenue and order count over the window, grouped the way the date bar says.
 *
 * Shared by the overview and the sales tab: it is the same question, and two copies would be
 * two places for a grouping bug. The server buckets by day or month in WIB; weeks and quarters
 * are folded from those here.
 */
export function SalesSeriesCard({
  ctx,
  detailHref,
  className,
}: {
  ctx: InsightCtx;
  detailHref?: string;
  className?: string;
}) {
  const { t, locale } = useT();
  const { role, range, grouping, depotIds } = ctx;
  const series = useInsightData(
    () =>
      api.get<SalesReport>(
        endpoints.reports.sales({
          from: range.from,
          to: range.to,
          granularity: granularityFor(grouping),
          depotIds,
        }),
        true,
      ),
    [range.from, range.to, grouping, depotIds?.join(',')],
    can('orderReports', role),
  );
  const rows = useMemo(
    () => (series.data ? regroup(series.data.buckets, grouping) : []),
    [series.data, grouping],
  );
  if (!can('orderReports', role)) return null;
  return (
    <WidgetCard
      title={t('insight.overview.seriesTitle')}
      source={series}
      isEmpty={(d) => d.buckets.length === 0}
      detailHref={detailHref}
      className={className}
    >
      {() => (
        <MultiLine
          labels={rows.map((b) => b.period)}
          formatLabel={(l) => periodLabel(l, locale)}
          ariaLabel={t('insight.overview.seriesAria')}
          series={[
            {
              label: t('insight.overview.seriesRevenue'),
              values: rows.map((b) => b.revenue),
              axis: 'left',
              tone: 'brand',
              money: true,
            },
            {
              label: t('insight.overview.seriesOrders'),
              values: rows.map((b) => b.orderCount),
              axis: 'right',
              tone: 'amber',
            },
          ]}
        />
      )}
    </WidgetCard>
  );
}
