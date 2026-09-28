'use client';

import { ChartBar } from '@phosphor-icons/react';

import { Card } from '@/components/ui';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import type { DepotHourBucket } from '@/lib/types';

/** Hours that carry a label on the axis — all 24 would not fit a 320px phone. */
const AXIS_HOURS = new Set([0, 3, 6, 9, 12, 15, 18, 21]);

const clock = (hour: number): string => `${String(hour % 24).padStart(2, '0')}.00`;

/**
 * The hour with the most orders, or null when nothing sold. A tie goes to the EARLIER hour:
 * the sentence under the chart names one hour, and "which of the two" is not a question a
 * depot planning its morning staffing needs answered differently on every render.
 */
export function busiestHour(hours: readonly DepotHourBucket[]): DepotHourBucket | null {
  let best: DepotHourBucket | null = null;
  for (const h of hours) {
    if (h.orders > 0 && (best === null || h.orders > best.orders)) best = h;
  }
  return best;
}

/**
 * When the depot is busy, by hour of the business day (Asia/Jakarta, decided by the server —
 * a browser in another zone must not move the morning rush).
 *
 * Bar height is ORDERS, not revenue: "busy" is a staffing question, and a single big
 * order at 03:00 should not read as a rush. The exact revenue is still in each bar's tooltip.
 * Every tied-for-busiest hour is highlighted, and the written summary sits above the chart
 * so the answer is text a screen reader and a phone in bright sun can both get.
 */
export function HourChart({ hours }: { hours: readonly DepotHourBucket[] }) {
  const { t } = useT();
  const peak = busiestHour(hours);
  const most = peak?.orders ?? 0;
  const summary = peak
    ? t('opsFix.reports.hoursPeak', {
        from: clock(peak.hour),
        to: clock(peak.hour + 1),
        orders: peak.orders,
      })
    : '';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-sm font-extrabold">
        <ChartBar size={18} weight="fill" className="text-brand-500" /> {t('opsFix.reports.hoursTitle')}
      </div>
      {peak === null ? (
        <p className="py-6 text-center text-sm text-muted">{t('opsFix.reports.hoursEmpty')}</p>
      ) : (
        <>
          <p className="text-[12.5px] text-muted">{summary}</p>
          <div
            role="img"
            aria-label={t('opsFix.reports.hoursAria', { peak: summary })}
            className="flex items-end gap-[2px]"
            style={{ height: 96 }}
          >
            {hours.map((h) => (
              <div key={h.hour} className="flex h-full min-w-0 flex-1 items-end">
                <div
                  title={`${clock(h.hour)} · ${h.orders} · ${formatIDR(h.revenueIdr)}`}
                  className={`w-full rounded-t-sm ${h.orders === most ? 'bg-brand-600' : 'bg-brand-50'}`}
                  style={{ height: `${h.orders === 0 ? 2 : Math.max(6, Math.round((h.orders / most) * 100))}%` }}
                />
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="flex gap-[2px] text-[9px] text-muted">
            {hours.map((h) => (
              <span key={h.hour} className="min-w-0 flex-1 whitespace-nowrap">
                {AXIS_HOURS.has(h.hour) ? String(h.hour).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
