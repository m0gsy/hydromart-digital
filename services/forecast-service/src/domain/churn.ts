const MS_PER_DAY = 86_400_000;

// Frequency dampening (the F in RFM-lite): each prior order beyond the first lowers churn
// risk, because habitual buyers churn less than one-time buyers at the same recency. Floored
// so even a very loyal but long-lapsed customer still registers meaningful risk.
const FREQ_DAMP_PER_ORDER = 0.1;
const FREQ_DAMP_FLOOR = 0.5;

export type ChurnBand = 'LOW' | 'MEDIUM' | 'HIGH';

export type ChurnRisk = {
  daysSince: number;
  riskScore: number;
  riskBand: ChurnBand;
};

/**
 * Recency + frequency churn risk (RFM-lite: R and F) for one customer. Pure — `now` is passed
 * in, never read from the clock. `daysSince` floors elapsed days since the last order; recency
 * = daysSince/windowDays clamped to [0,1]; a frequency weight (more prior orders => lower risk,
 * floored at FREQ_DAMP_FLOOR) dampens it into `riskScore`. Band splits the [0,1] score into
 * tertiles: HIGH >= 2/3, MEDIUM >= 1/3, else LOW.
 * ponytail: Monetary (the M) is not folded in — CustomerActivity carries no spend total yet;
 * upgrade path is add a totalSpent column to the read model + a monetary factor at this seam.
 */
export function churnRisk(
  activity: { lastOrderAt: Date; orderCount: number },
  now: Date,
  opts: { windowDays: number },
): ChurnRisk {
  const daysSince = Math.floor((now.getTime() - activity.lastOrderAt.getTime()) / MS_PER_DAY);
  const recency = Math.min(1, Math.max(0, daysSince / opts.windowDays));
  const priorOrders = Math.max(0, activity.orderCount - 1);
  const freqWeight = Math.max(FREQ_DAMP_FLOOR, 1 - priorOrders * FREQ_DAMP_PER_ORDER);
  const riskScore = recency * freqWeight;
  const riskBand: ChurnBand =
    riskScore >= 2 / 3 ? 'HIGH' : riskScore >= 1 / 3 ? 'MEDIUM' : 'LOW';
  return { daysSince, riskScore, riskBand };
}
