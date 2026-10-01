'use client';

import { Card } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import type { DepotRefillSplit } from '@/lib/types';

/**
 * #27: counter galon sales split by whether the buyer handed over an empty at the till.
 *
 * Nothing shown — not a row of zeros — when no counter sale that day had a galon line to
 * classify: a depot that sold no galons has no refill/beli mix to report, and "0 · 0 · 0"
 * would read as a measured fact rather than nothing to measure.
 */
export function RefillSplit({ split }: { split: DepotRefillSplit }) {
  const { t } = useT();
  const total = split.refill + split.partial + split.beli;
  if (total === 0) return null;

  const cells: { label: string; value: number }[] = [
    { label: t('opsFix.reports.refillFull'), value: split.refill },
    { label: t('opsFix.reports.refillPartial'), value: split.partial },
    { label: t('opsFix.reports.refillBeli'), value: split.beli },
  ];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="text-sm font-extrabold">{t('opsFix.reports.refillSplitTitle')}</div>
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div
            key={c.label}
            className="flex flex-col items-center gap-0.5 rounded-xl bg-[color:var(--surface-soft)] py-2.5"
          >
            <span className="text-lg font-extrabold tabular-nums">{c.value}</span>
            <span className="text-center text-[10.5px] font-semibold leading-tight text-muted">
              {c.label}
            </span>
          </div>
        ))}
      </div>
      {split.notAsked > 0 && (
        <p className="text-[11px] text-muted">
          {t('opsFix.reports.refillNotAsked', { n: split.notAsked })}
        </p>
      )}
    </Card>
  );
}
