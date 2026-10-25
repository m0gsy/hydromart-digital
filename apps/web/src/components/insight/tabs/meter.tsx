'use client';

import { MultiLine } from '@/components/hq/charts';
import type { InsightCtx } from '@/components/insight/context';
import { KpiCard } from '@/components/insight/kpi-card';
import { WidgetCard } from '@/components/insight/widget-card';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { dayStartWib, todayWib } from '@/lib/wib';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { periodLabel } from '@/lib/insight/label';
import { spanDays } from '@/lib/insight/range';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import type { MeterHistoryRow } from '@/lib/types';

const dash = '—';
/** The longest history the server returns for one request. */
const MAX_METER_DAYS = 92;
const liters = (n: number): string => `${Math.round(n).toLocaleString('id-ID')} L`;

/**
 * Meter Air & Produksi: what the meter says was produced against what the orders say was sold.
 *
 * The gap is an INDICATION, said so on screen: it is the meter's liters minus the liters on the
 * order lines, and lines recorded with no volume are not in it. It is not proof of a leak.
 */
export function MeterTab({ ctx }: { ctx: InsightCtx }) {
  const { t, locale } = useT();
  const { role, range, depotId } = ctx;
  const mayRead = can('meterRead', role);
  // The server reads at most 92 days and defaults `to` to the UTC date, so both bounds are sent:
  // the window's end (never later than tomorrow, there is nothing to read after today) and, if the
  // window is longer than the server reads, only its last 92 days.
  const tomorrow = dayStartWib(addDaysFrom(todayWib(), 1));
  const until = Date.parse(range.to) > Date.parse(tomorrow) ? tomorrow : range.to;
  const capped = spanDays({ from: range.from, to: until }) > MAX_METER_DAYS;
  const from = capped ? dayStartWib(addDaysFrom(until, -MAX_METER_DAYS)) : range.from;
  // A window that is entirely in the future has nothing to read, and the server refuses it.
  const readable = Date.parse(from) < Date.parse(until);
  // The server slices these to the UTC date, so plain WIB dates are sent: the first day in the
  // window and the last one (`until` is exclusive).
  const fromDay = todayWib(new Date(from));
  const toDay = todayWib(new Date(Date.parse(until) - 1));

  const history = useInsightData(
    () =>
      api.get<MeterHistoryRow[]>(
        endpoints.reports.meterHistory(depotId as string, { from: fromDay, to: toDay }),
        true,
      ),
    [depotId, fromDay, toDay],
    mayRead && depotId != null && readable,
  );
  const rows = history.data ?? [];
  const measured = rows.filter((r) => r.varianceLiters != null);
  const totalGap = measured.reduce((n, r) => n + (r.varianceLiters ?? 0), 0);
  const yields = rows.filter((r) => r.roYieldPct != null);
  const avgYield = yields.length
    ? yields.reduce((n, r) => n + (r.roYieldPct ?? 0), 0) / yields.length
    : null;

  return (
    <div className="flex flex-col gap-6">
      {mayRead && depotId == null && (
        <p className="text-xs text-muted">{t('insight.meter.needDepot')}</p>
      )}
      {capped && <p className="text-xs text-muted">{t('insight.meter.capped')}</p>}

      {mayRead && depotId != null && !history.forbidden && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label={t('insight.meter.gap')}
            value={history.data && measured.length > 0 ? liters(totalGap) : dash}
            hint={
              history.data
                ? t('insight.meter.daysRead', { n: measured.length, total: rows.length })
                : undefined
            }
            definition={t('insight.meter.gapDef')}
          />
          <KpiCard
            label={t('insight.meter.yield')}
            value={avgYield != null ? `${Math.round(avgYield)}%` : dash}
            definition={t('insight.meter.yieldDef')}
          />
          <KpiCard
            label={t('insight.meter.unread')}
            value={history.data && rows.length > 0 ? String(rows.length - measured.length) : dash}
            definition={t('insight.meter.unreadDef')}
            tone={rows.length - measured.length > 0 ? 'danger' : undefined}
            goodWhen="down"
          />
        </section>
      )}

      {mayRead && depotId != null && (
        <WidgetCard
          title={t('insight.meter.title')}
          source={history}
          isEmpty={(d) => d.length === 0}
          emptyText={t('insight.meter.empty')}
          detailHref="/dashboard/meter"
        >
          {(d) => (
            <MultiLine
              labels={d.filter((r) => r.meterLiters != null).map((r) => r.day)}
              formatLabel={(l) => periodLabel(l, locale)}
              ariaLabel={t('insight.meter.aria')}
              series={[
                {
                  label: t('insight.meter.produced'),
                  values: d
                    .filter((r) => r.meterLiters != null)
                    .map((r) => r.meterLiters as number),
                  axis: 'left',
                  tone: 'brand',
                },
                {
                  label: t('insight.meter.sold'),
                  values: d.filter((r) => r.meterLiters != null).map((r) => r.soldLiters),
                  axis: 'left',
                  tone: 'amber',
                },
              ]}
            />
          )}
        </WidgetCard>
      )}
    </div>
  );
}

/** An ISO instant or `YYYY-MM-DD` moved by whole calendar days, returned as `YYYY-MM-DD`. */
function addDaysFrom(at: string, days: number): string {
  const day = at.length === 10 ? at : todayWib(new Date(at));
  const [y, m, d] = day.split('-').map(Number);
  // tz-ok: built at UTC midnight from a plain date, so the slice reads the same date back.
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}
