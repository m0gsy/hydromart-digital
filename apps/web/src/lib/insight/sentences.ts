import { formatPct, type Delta } from '@/lib/insight/delta';

/**
 * The one-line reading of a section ("Revenue is up 12.3% and orders are up 8.0%…").
 *
 * Built from the numbers, never typed: a sentence that states a trend has to be true of the
 * window it sits above, so it is chosen from the two deltas and says nothing at all when either
 * has no base to compare with. A missing sentence is honest; a wrong one is not.
 */
export interface Sentence {
  /** i18n key under `insight.sentence.*`. */
  key: string;
  vars: Record<string, string>;
}

export function overviewSentence(revenue: Delta, orders: Delta): Sentence | null {
  if (revenue.kind === 'none' || orders.kind === 'none') return null;
  const vars = {
    revenue: revenue.kind === 'flat' ? '0,0' : formatPct(revenue.pct),
    orders: orders.kind === 'flat' ? '0,0' : formatPct(orders.pct),
  };
  if (revenue.kind === 'flat') return { key: 'insight.sentence.flat', vars };
  if (revenue.kind === 'up') {
    return {
      key: orders.kind === 'up' ? 'insight.sentence.upBoth' : 'insight.sentence.revenueUp',
      vars,
    };
  }
  return {
    key: orders.kind === 'down' ? 'insight.sentence.downBoth' : 'insight.sentence.revenueDown',
    vars,
  };
}
