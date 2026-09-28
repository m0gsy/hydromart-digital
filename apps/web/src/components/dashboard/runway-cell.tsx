'use client';

import { useT } from '@/lib/locale-context';
import { stockRunway } from '@/lib/forecast';

/**
 * The "days to stockout" cell of the forecast table.
 *
 * A real count of days when there is a stock figure and something sells; "Aman" ONLY when stock
 * is known and nothing is selling; and "—", with the reason on hover, when the depot has no
 * stock figure for the product. The last two used to be the same word, which told the reader a
 * product nobody tracks was safe.
 */
export function RunwayCell({
  available,
  avgDaily,
}: {
  available: number | undefined;
  avgDaily: number;
}) {
  const { t } = useT();
  const runway = stockRunway(available, avgDaily);

  if (runway.state === 'unknown') {
    return (
      <td
        className="px-4 py-3 text-right tabular-nums text-muted"
        title={t('dashboard.forecast.stockUnknownHint')}
      >
        {t('dashboard.forecast.daysToStockoutUnknown')}
      </td>
    );
  }
  if (runway.state === 'no-demand') {
    return (
      <td className="px-4 py-3 text-right tabular-nums">{t('dashboard.forecast.daysToStockoutNa')}</td>
    );
  }
  return (
    <td
      className={`px-4 py-3 text-right tabular-nums ${runway.days <= 3 ? 'font-semibold text-[color:var(--warning)]' : ''}`}
    >
      {t('dashboard.forecast.daysToStockoutValue', { n: runway.days })}
    </td>
  );
}
