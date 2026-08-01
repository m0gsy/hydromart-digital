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

/** The delivery date one frequency-cycle after `from`. */
export function advanceDelivery(from: Date, frequency: SubscriptionFrequency): Date {
  return new Date(from.getTime() + FREQUENCY_DAYS[frequency] * 24 * 60 * 60 * 1000);
}
