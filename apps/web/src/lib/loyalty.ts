// Pure loyalty helpers. Covered by test/loyalty.test.ts.

import type { TierBenefit } from './types';

export interface TierProgress {
  /** The next tier up, or null if already at the top. */
  next: TierBenefit | null;
  /** Points still needed to reach `next` (0 when at the top). */
  pointsToNext: number;
  /** Fraction [0,1] of the way from the current tier's threshold to the next. */
  fraction: number;
}

/**
 * Given the ascending-by-threshold tier ladder and a customer's lifetime points,
 * work out the next tier and how far along they are toward it. `tiers` is expected
 * sorted ascending (as the loyalty service returns it); an empty ladder yields a
 * finished (top) result.
 */
export function tierProgress(tiers: TierBenefit[], lifetimePoints: number): TierProgress {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const next = sorted.find((t) => t.threshold > lifetimePoints) ?? null;
  if (!next) return { next: null, pointsToNext: 0, fraction: 1 };

  // Current threshold = highest tier already reached (0 if below the first rung).
  const current = sorted.filter((t) => t.threshold <= lifetimePoints).at(-1)?.threshold ?? 0;
  const span = next.threshold - current;
  const gained = lifetimePoints - current;
  return {
    next,
    pointsToNext: next.threshold - lifetimePoints,
    fraction: span > 0 ? Math.min(1, Math.max(0, gained / span)) : 1,
  };
}
