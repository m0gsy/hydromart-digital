'use client';

import { HeatTable } from '@/components/hq/charts';
import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR, shortWeekdays } from '@/lib/format';
import { peakCell, peakIndex } from '@/lib/insight/peak';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { TimeAreaReport } from '@/lib/types';

const dash = '—';
const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}.00`;
const HOURS = Array.from({ length: 24 }, (_, h) => String(h));

/** A thin bar whose length is `value` against the largest in its list. */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
      <div
        className="h-full rounded-full bg-brand-600"
        style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }}
      />
    </div>
  );
}

/** Pola Waktu & Area: when orders come in and which cities they go to. */
export function TimeTab({ ctx }: { ctx: InsightCtx }) {
  const { t, locale } = useT();
  const { role, range, depotIds } = ctx;
  const enabled = can('orderReports', role);
  const days = shortWeekdays(locale);
  const scope = depotIds?.join(',');

  const report = useInsightData(
    () =>
      api.get<TimeAreaReport>(
        endpoints.reports.timeArea({ from: range.from, to: range.to, depotIds: scope }),
        true,
      ),
    [range.from, range.to, scope],
    enabled,
  );
  if (!enabled) return null;

  const d = report.data;
  const peak = d ? peakCell(d.heat) : null;
  const busiestDay = d ? peakIndex(d.byWeekday.map((x) => x.orders)) : null;
  const topArea = d?.byArea[0];
  const maxDay = Math.max(0, ...(d?.byWeekday.map((x) => x.orders) ?? []));
  const maxArea = Math.max(0, ...(d?.byArea.map((x) => x.orders) ?? []));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-muted">{t('insight.time.note')}</p>

      {!report.forbidden && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label={t('insight.time.peakHour')}
            value={peak ? `${days[peak.weekday] ?? ''} ${hourLabel(peak.hour)}` : dash}
            hint={peak ? t('insight.time.peakOrders', { n: peak.orders }) : undefined}
            definition={t('insight.time.peakHourDef')}
          />
          <KpiCard
            label={t('insight.time.peakDay')}
            value={busiestDay != null ? (days[busiestDay] ?? dash) : dash}
            hint={
              busiestDay != null && d
                ? t('insight.time.peakOrders', { n: d.byWeekday[busiestDay]?.orders ?? 0 })
                : undefined
            }
            definition={t('insight.time.peakDayDef')}
          />
          <KpiCard
            label={t('insight.time.topArea')}
            value={topArea ? topArea.area : dash}
            hint={topArea ? t('insight.time.peakOrders', { n: topArea.orders }) : undefined}
            definition={t('insight.time.topAreaDef')}
          />
        </section>
      )}

      <WidgetCard
        title={t('insight.time.heatTitle')}
        source={report}
        isEmpty={(r) => r.orders === 0}
        emptyText={t('insight.time.empty')}
      >
        {(r) => (
          <HeatTable
            columns={HOURS}
            rows={r.heat.map((values, i) => ({ label: days[i] ?? String(i), values }))}
            format={(n) => String(n)}
            rowHeader={t('insight.time.dayHeader')}
            totalLabel={t('insight.time.total')}
            ariaLabel={t('insight.time.heatAria')}
            scrollHint={t('insight.time.scrollHint')}
          />
        )}
      </WidgetCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WidgetCard
          title={t('insight.time.weekdayTitle')}
          source={report}
          isEmpty={(r) => r.orders === 0}
          emptyText={t('insight.time.empty')}
        >
          {(r) => (
            <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              {r.byWeekday.map((x) => (
                <li key={x.weekday} className="flex flex-col gap-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{days[x.weekday]}</span>
                    <span className="tabular-nums">
                      {t('insight.time.line', { n: x.orders, revenue: formatIDR(x.revenue) })}
                    </span>
                  </div>
                  <Bar value={x.orders} max={maxDay} />
                </li>
              ))}
            </ol>
          )}
        </WidgetCard>

        <WidgetCard
          title={t('insight.time.areaTitle')}
          source={report}
          isEmpty={(r) => r.byArea.length === 0}
          emptyText={t('insight.time.areaEmpty')}
        >
          {(r) => (
            <div className="flex flex-col gap-2">
              <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                {r.byArea.map((x) => (
                  <li key={x.area} className="flex flex-col gap-1">
                    <div className="flex justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">{x.area}</span>
                      <span className="shrink-0 tabular-nums">
                        {t('insight.time.line', { n: x.orders, revenue: formatIDR(x.revenue) })}
                      </span>
                    </div>
                    <Bar value={x.orders} max={maxArea} />
                  </li>
                ))}
              </ol>
              {r.otherAreas && (
                <p className="text-xs text-muted">
                  {t('insight.time.other', { areas: r.otherAreas.areas, n: r.otherAreas.orders })}
                </p>
              )}
              <p className="text-[11px] text-muted">{t('insight.time.areaNote')}</p>
            </div>
          )}
        </WidgetCard>
      </div>
    </div>
  );
}
