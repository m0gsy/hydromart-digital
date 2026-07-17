/**
 * Courier earning rules (design 6b). Framework-free. The money math for a completed
 * delivery lives here, applied in payout-service — delivery-service only reports the
 * raw event ({deliveredAt, onTime}), so the rate policy has exactly one home.
 */

export type CourierLedgerEntryType =
  | 'EARNING'
  | 'DEDUCTION'
  | 'CASH_VARIANCE'
  | 'WITHDRAWAL'
  | 'ADJUSTMENT';

export interface CourierEarningRule {
  baseFare: number;
  peakBonus: number;
  onTimeBonus: number;
  /** Peak window [start, end) in local hour-of-day. */
  peakStartHour: number;
  peakEndHour: number;
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
