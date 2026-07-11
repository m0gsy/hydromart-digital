const MS_PER_DAY = 86_400_000;

// Frequency dampening (the F in RFM-lite): each prior order beyond the first lowers churn
// risk, because habitual buyers churn less than one-time buyers at the same recency. Floored
// so even a very loyal but long-lapsed customer still registers meaningful risk.
const FREQ_DAMP_PER_ORDER = 0.1;
const FREQ_DAMP_FLOOR = 0.5;

// Monetary dampening (the M in RFM-lite): higher lifetime spend lowers churn risk, scaling
// linearly from 1 (no spend) down to MON_DAMP_FLOOR at/above the monetaryRef rupiah threshold.
// Softer than frequency (higher floor) — a big past spender can still lapse. Off (weight 1)
// when monetaryRef <= 0, so callers that don't supply it keep pure recency+frequency scoring.
const MON_DAMP_FLOOR = 0.6;

export type ChurnBand = 'LOW' | 'MEDIUM' | 'HIGH';

export type ChurnRisk = {
  daysSince: number;
  riskScore: number;
  riskBand: ChurnBand;
};

/**
 * Recency + frequency + monetary churn risk (RFM-lite) for one customer. Pure — `now` is passed
 * in, never read from the clock. `daysSince` floors elapsed days since the last order; recency
 * = daysSince/windowDays clamped to [0,1]; a frequency weight (more prior orders => lower risk,
 * floored at FREQ_DAMP_FLOOR) and a monetary weight (more lifetime spend => lower risk, floored
 * at MON_DAMP_FLOOR, off when `monetaryRef` unset/<=0) both dampen it into `riskScore`. Band
 * splits the [0,1] score into tertiles: HIGH >= 2/3, MEDIUM >= 1/3, else LOW.
 * ponytail: heuristic RFM-lite — no ML/seasonality; the three factors multiply (no learned
 * weights). Upgrade path is a fitted model at this seam.
 */
export function churnRisk(
  activity: { lastOrderAt: Date; orderCount: number; totalSpent?: number },
  now: Date,
  opts: { windowDays: number; monetaryRef?: number },
): ChurnRisk {
  const daysSince = Math.floor((now.getTime() - activity.lastOrderAt.getTime()) / MS_PER_DAY);
  const recency = Math.min(1, Math.max(0, daysSince / opts.windowDays));
  const priorOrders = Math.max(0, activity.orderCount - 1);
  const freqWeight = Math.max(FREQ_DAMP_FLOOR, 1 - priorOrders * FREQ_DAMP_PER_ORDER);
  const monetaryRef = opts.monetaryRef ?? 0;
  const monWeight =
    monetaryRef > 0
      ? 1 - Math.min(1, Math.max(0, activity.totalSpent ?? 0) / monetaryRef) * (1 - MON_DAMP_FLOOR)
      : 1;
  const riskScore = recency * freqWeight * monWeight;
  const riskBand: ChurnBand =
    riskScore >= 2 / 3 ? 'HIGH' : riskScore >= 1 / 3 ? 'MEDIUM' : 'LOW';
  return { daysSince, riskScore, riskBand };
}
