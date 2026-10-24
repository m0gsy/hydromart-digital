'use client';

import { MultiLine } from '@/components/hq/charts';
import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { SalesForecast } from '@/lib/types';

const HISTORY_DAYS = 30;
const HORIZON_DAYS = 14;

/** The next two weeks of revenue for one depot, drawn after the last month of actuals. */
export function SalesForecastCard({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const { role, depotId } = ctx;
  const enabled = can('forecast', role) && depotId != null;
  const forecast = useInsightData(
    () =>
      api.get<SalesForecast>(
        endpoints.forecast.sales({
          depotId: depotId as string,
          historyDays: HISTORY_DAYS,
          horizonDays: HORIZON_DAYS,
        }),
        true,
      ),
    [depotId],
    enabled,
  );
  if (!can('forecast', role)) return null;
  if (depotId == null) {
    return <p className="text-xs text-muted">{t('insight.forecast.needDepot')}</p>;
  }

  return (
    <WidgetCard
      title={t('insight.forecast.title')}
      source={forecast}
      isEmpty={(d) => d.history.length === 0 && d.predictedDaily.length === 0}
      emptyText={t('insight.forecast.empty')}
      detailHref="/dashboard/forecast"
    >
      {(d) => {
        const labels = [
          ...d.history.map((_, i) => String(i - d.history.length)),
          ...d.predictedDaily.map((_, i) => `+${i + 1}`),
        ];
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <KpiCard
                label={t('insight.forecast.total', { days: d.predictedDaily.length })}
                value={formatIDR(d.predictedTotal)}
                definition={t('insight.forecast.totalDef')}
              />
              <KpiCard
                label={t('insight.forecast.avg')}
                value={formatIDR(d.avgDaily)}
                definition={t('insight.forecast.avgDef')}
              />
            </div>
            <MultiLine
              labels={labels}
              ariaLabel={t('insight.forecast.aria')}
              series={[
                {
                  label: t('insight.forecast.line'),
                  values: [...d.history, ...d.predictedDaily],
                  axis: 'left',
                  tone: 'brand',
                  money: true,
                },
              ]}
            />
            <p className="text-[11px] text-muted">{t('insight.forecast.note')}</p>
          </div>
        );
      }}
    </WidgetCard>
  );
}
