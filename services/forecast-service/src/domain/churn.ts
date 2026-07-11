const MS_PER_DAY = 86_400_000;

export type ChurnBand = 'LOW' | 'MEDIUM' | 'HIGH';

export type ChurnRisk = {
  daysSince: number;
  riskScore: number;
  riskBand: ChurnBand;
};

/**
 * Recency-driven churn risk for one customer. Pure — `now` is passed in, never read from the
 * clock. `daysSince` floors elapsed days since the last order; `riskScore` is that normalised
 * to [0,1] over `windowDays`; band is HIGH at/over the window, MEDIUM at/over half, else LOW.
 * ponytail: single-factor (recency). orderCount is carried for context but not folded into the
 * score yet — upgrade path is full RFM at this same seam.
 */
export function churnRisk(
  activity: { lastOrderAt: Date; orderCount: number },
  now: Date,
  opts: { windowDays: number },
): ChurnRisk {
  const daysSince = Math.floor((now.getTime() - activity.lastOrderAt.getTime()) / MS_PER_DAY);
  const riskScore = Math.min(1, Math.max(0, daysSince / opts.windowDays));
  const riskBand: ChurnBand =
    daysSince >= opts.windowDays ? 'HIGH' : daysSince >= opts.windowDays / 2 ? 'MEDIUM' : 'LOW';
  return { daysSince, riskScore, riskBand };
}
