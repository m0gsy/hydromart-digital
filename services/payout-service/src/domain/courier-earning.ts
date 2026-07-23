/**
 * Courier earning rules (design 6b). Framework-free. The money math for a completed
 * delivery lives here, applied in payout-service — delivery-service only reports the
 * raw event ({deliveredAt, onTime}), so the rate policy has exactly one home.
 */

export type CourierLedgerEntryType =
  | 'EARNING'
  | 'INCENTIVE'
  | 'DEDUCTION'
  | 'CASH_VARIANCE'
  | 'WITHDRAWAL'
  | 'ADJUSTMENT';

/** One rung of a rule's monthly delivery-count incentive ladder. */
export interface IncentiveTier {
  /** Completed deliveries in the month that unlock the bonus. */
  deliveries: number;
  /** One-off IDR credit posted when the rung is reached. */
  bonus: number;
}

export interface CourierEarningRule {
  baseFare: number;
  peakBonus: number;
  onTimeBonus: number;
  /** Peak window [start, end) in local hour-of-day. */
  peakStartHour: number;
  peakEndHour: number;
  /** Monthly earnings target shown to the courier (IDR); 0 = no target configured. */
  monthlyTarget: number;
  /** Incentive ladder, ascending by delivery count; empty = no incentives. */
  tiers: IncentiveTier[];
}

export interface DeliveryEarningEvent {
  /** Local hour-of-day the delivery completed (0..23). */
  hour: number;
  onTime: boolean;
}

/**
 * Whether an hour falls in the peak window [start, end). Non-wrapping: a window that
 * crosses midnight (start > end) is treated as empty.
 * ponytail: single daytime window; add a second window (lunch + dinner) only if a
 * depot's demand actually needs it.
 */
export function isPeak(hour: number, startHour: number, endHour: number): boolean {
  return startHour < endHour && hour >= startHour && hour < endHour;
}

/** Pay for one completed delivery: base + peak bonus (if peak) + on-time bonus. */
export function computeEarning(rule: CourierEarningRule, event: DeliveryEarningEvent): number {
  const peak = isPeak(event.hour, rule.peakStartHour, rule.peakEndHour) ? rule.peakBonus : 0;
  const onTime = event.onTime ? rule.onTimeBonus : 0;
  return rule.baseFare + peak + onTime;
}

/**
 * Tiers unlocked at `deliveries` completed this month, ascending. Every reached rung is
 * returned (not only the newest one) — the caller keys each credit by tier and skips the
 * ones already posted, so a backfilled or out-of-order delivery still pays every rung once.
 */
export function tiersReached(tiers: IncentiveTier[], deliveries: number): IncentiveTier[] {
  return tiers
    .filter((t) => t.deliveries > 0 && deliveries >= t.deliveries)
    .sort((a, b) => a.deliveries - b.deliveries);
}

/** True when the ladder is usable: positive, strictly ascending counts and non-negative bonuses. */
export function tiersValid(tiers: IncentiveTier[]): boolean {
  const counts = tiers.map((t) => t.deliveries);
  return (
    tiers.every(
      (t) => Number.isInteger(t.deliveries) && t.deliveries > 0 && t.bonus >= 0,
    ) && new Set(counts).size === counts.length
  );
}
