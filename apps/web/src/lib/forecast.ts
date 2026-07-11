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
