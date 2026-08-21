import { SubscriptionFrequency } from '../application/ports/subscription.repository';

// The spec-7b subscription discount used to live here as a 5% constant. It is a
// per-depot setting now (order `subscriptionDiscountPct`, OrderConfigService
// .subscriptionDiscountRate) — a rate a depot funds is a rate a depot sets.

// ponytail: a month is approximated as 30 days — good enough for delivery cadence;
// swap for a calendar-month step if exact billing-day alignment is ever needed.
const FREQUENCY_DAYS: Record<SubscriptionFrequency, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
};

/**
 * D4: the next delivery on or after `notBefore`, stepping the plan's own cadence from
 * `from` — so the delivery DAY is preserved across a pause.
 *
 * Pausing never touched `nextDeliveryAt`, so a plan slept holding a due date in the past
 * and the first sweep after resuming delivered immediately: the customer paused their
 * water and got a gallon on the doorstep the moment they came back.
 *
 * Stepping the cadence rather than just adding one interval to today is what keeps a
 * Tuesday plan on Tuesdays. Adding one interval to the resume moment would silently move
 * every paused plan to whatever weekday the customer happened to press the button.
 */
export function nextDeliveryOnOrAfter(
  from: Date,
  frequency: SubscriptionFrequency,
  notBefore: Date,
): Date {
  const stepMs = FREQUENCY_DAYS[frequency] * 24 * 60 * 60 * 1000;
  if (from.getTime() > notBefore.getTime()) return from;
  // Whole cadences missed, jumped in one arithmetic step rather than a loop — a plan
  // paused for a year would otherwise spin 52 times to answer.
  const missed = Math.ceil((notBefore.getTime() - from.getTime()) / stepMs);
  const next = new Date(from.getTime() + missed * stepMs);
  // `ceil` lands exactly on `notBefore` when the pause was a whole number of cadences.
  // That instant is already due, so take one more step.
  return next.getTime() > notBefore.getTime() ? next : new Date(next.getTime() + stepMs);
}
