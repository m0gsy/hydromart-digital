import { BadRequestException } from '@nestjs/common';

/**
 * AI-7a: `split=depot`. Only a scalar, non-people metric whose total is a plain sum over depots may
 * be split. A per-depot answer beside a network answer lets a reader subtract small groups, so every
 * people metric, ratio, object, balance and "now" figure refuses it (400).
 */
export const SPLITTABLE_METRICS: ReadonlySet<string> = new Set(['P-01', 'P-04', 'P-07', 'P-10', 'G-01']);

export interface DepotSplit {
  total: number;
  byDepot: { depotId: string; value: number }[];
}

/** Whether the query asks for the split; any value but `depot` is a 400. */
export function wantsSplit(query: { split?: string }): boolean {
  if (query.split === undefined) return false;
  if (query.split !== 'depot') throw new BadRequestException('split hanya boleh bernilai depot');
  return true;
}

/**
 * The 400 for a metric that cannot be split. A no-op without `split`, and for an id outside the
 * group's `registry` (the service answers that one 404, which comes before this rule).
 */
export function assertSplittable(metricId: string, query: { split?: string }, registry: object): void {
  if (!Object.prototype.hasOwnProperty.call(registry, metricId)) return;
  if (wantsSplit(query) && !SPLITTABLE_METRICS.has(metricId)) {
    throw new BadRequestException(`${metricId} tidak bisa dipecah per depot`);
  }
}

/** Every depot of the scope once (0 is a real value), `total` being the unsplit answer. */
export function splitByDepot<T extends { depotId: string }>(
  depotIds: readonly string[],
  rows: readonly T[],
  pick: (r: T) => number,
  round: (n: number) => number = (n) => n,
): DepotSplit {
  const by = new Map<string, number>(depotIds.map((d) => [d, 0]));
  let all = 0;
  for (const r of rows) {
    by.set(r.depotId, (by.get(r.depotId) ?? 0) + pick(r));
    all += pick(r);
  }
  return { total: round(all), byDepot: [...by.entries()].map(([depotId, v]) => ({ depotId, value: round(v) })) };
}
