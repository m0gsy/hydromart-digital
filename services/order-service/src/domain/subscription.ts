import { SubscriptionFrequency } from '../application/ports/subscription.repository';

/** Spec 7b: every subscription delivery is discounted 5% ("hemat 5%"). */
export const SUBSCRIPTION_DISCOUNT_RATE = 0.05;

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
