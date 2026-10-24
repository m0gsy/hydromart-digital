'use client';

import type { InsightCtx } from '@/components/insight/context';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { RecentActivity } from '@/lib/types';

/** The orders touched most recently: number, where it stands, how much, and through which door. */
export function RecentActivityCard({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, depotIds, depotNames } = ctx;
  const enabled = can('orderReports', role);
  const scope = depotIds?.join(',');
  const feed = useInsightData(
    () =>
      api.get<RecentActivity>(
        endpoints.reports.recentActivity({ limit: 15, depotIds: scope }),
        true,
      ),
    [scope],
    enabled,
  );
  if (!enabled) return null;
  return (
    <WidgetCard
      title={t('insight.activity.title')}
      source={feed}
      isEmpty={(d) => d.items.length === 0}
      emptyText={t('insight.activity.empty')}
      detailHref="/dashboard/orders"
    >
      {(d) => (
        <ul className="m-0 flex list-none flex-col divide-y divide-[color:var(--border,#e9e7df)] p-0 text-sm">
          {d.items.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="m-0 font-semibold">{x.orderNumber}</p>
                <p className="m-0 text-xs text-muted">
                  {t(`insight.activity.status.${x.status}`)} ·{' '}
                  {x.isWalkIn ? t('insight.activity.counter') : t('insight.activity.app')}
                  {x.depotId && depotNames[x.depotId] ? ` · ${depotNames[x.depotId]}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="m-0 font-semibold tabular-nums">{formatIDR(x.total)}</p>
                <p className="m-0 text-xs text-muted">{formatDateTime(x.updatedAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
