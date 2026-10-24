/**
 * "vs previous period" for a KPI.
 *
 * The honest answer to "how did this change" is sometimes "there is nothing to compare with":
 * a new depot has no last year, and a base of zero makes every percentage infinite. Those are
 * reported as `none`, never as 0% or as an arrow, because a flat arrow over a missing base
 * reads as "unchanged" — a claim nobody measured.
 */
export type Delta =
  { kind: 'none' } | { kind: 'flat'; pct: 0 } | { kind: 'up' | 'down'; pct: number };

/** Change below this magnitude (in percent) is reported as flat rather than as movement. */
const FLAT_BELOW_PCT = 0.05;

export function compare(current: number | null, base: number | null): Delta {
  if (current == null || base == null) return { kind: 'none' };
  if (!Number.isFinite(current) || !Number.isFinite(base)) return { kind: 'none' };
  // A base of zero (or less) has no percentage; "from nothing" is not a growth rate.
  if (base <= 0) return { kind: 'none' };
  const pct = ((current - base) / base) * 100;
  if (Math.abs(pct) < FLAT_BELOW_PCT) return { kind: 'flat', pct: 0 };
  return { kind: pct > 0 ? 'up' : 'down', pct: Math.abs(pct) };
}

/** One decimal, comma as the separator: 12.34 -> "12,3". */
export function formatPct(pct: number): string {
  return pct.toFixed(1).replace('.', ',');
}
