/**
 * The part of the abandoned-order sweep's candidate predicate that does not depend on the order's
 * own age, in ONE place: `findStaleIn` (what the sweep cancels) and the unpaid-order reminder
 * (HD-18, who is told it is about to be cancelled) both read it, so they cannot drift apart.
 *
 * - D1: a subscription delivery is never a candidate (`exemptSubscriptions`, the kill switch).
 * - W2b/ORD-05: an order booked for a slot is protected until the slot has passed by the window,
 *   i.e. `scheduledFor` is null or before `before`.
 */
export const abandonSweepEligible = (before: Date, exemptSubscriptions = true) => ({
  ...(exemptSubscriptions ? { subscriptionId: null } : {}),
  OR: [{ scheduledFor: null }, { scheduledFor: { lt: before } }],
});
