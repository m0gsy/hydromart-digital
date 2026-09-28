// Pure forecast presentation helper. Covered by test/forecast.test.ts.

export type TrendLabel = '↑ rising' | '↓ falling' | '→ flat';

// Epsilon: units/day of slope below which a trend reads as flat. 0.05 ≈ ~1.5
// units/month — small enough to ignore rounding noise, big enough to surface a
// real drift. Server owns the number; this only labels it.
const TREND_EPSILON = 0.05;

/** Human label for a demand trend slope (units/day). */
export function trendLabel(slope: number): TrendLabel {
  if (slope > TREND_EPSILON) return '↑ rising';
  if (slope < -TREND_EPSILON) return '↓ falling';
  return '→ flat';
}

/**
 * How long the stock on hand lasts at the forecast daily demand.
 *
 * Three answers, kept apart on purpose. The page used to collapse "the depot has no stock
 * figure for this product" and "nothing is selling" into one word — "Aman", safe — so a
 * product nobody tracks read as a product with no problem. Without a stock figure there is
 * nothing to call safe: that is UNKNOWN, and it must look different from a real "no demand".
 */
export type Runway =
  | { state: 'unknown' }
  | { state: 'no-demand' }
  | { state: 'days'; days: number };

export function stockRunway(available: number | undefined, avgDaily: number): Runway {
  if (available === undefined) return { state: 'unknown' };
  if (avgDaily <= 0) return { state: 'no-demand' };
  // Whole days, floored: 25 at 10/day runs out during day 3, so two full days remain. Reserved
  // stock can push `available` below zero; the runway is then "none", never a negative count.
  return { state: 'days', days: Math.max(0, Math.floor(available / avgDaily)) };
}

/**
 * What still has to be ordered: the forecast's reorder suggestion minus what is already on the
 * shelf, rounded up so the order is never short, and never below zero. Null when there is no
 * stock figure to subtract — the suggestion alone would order gallons the depot already holds.
 */
export function orderNeeded(suggestion: number, available: number | undefined): number | null {
  if (available === undefined) return null;
  return Math.max(0, Math.ceil(suggestion - available));
}
