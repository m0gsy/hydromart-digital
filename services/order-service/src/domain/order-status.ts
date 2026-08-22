/**
 * Order lifecycle (BR-012). The status graph is strictly forward, with CANCELLED
 * reachable from every pre-completion state. This module is framework-free domain
 * logic — the single source of truth for which transitions are legal.
 *
 * The graph is the SYSTEM's rule; BR-006 ("a customer may cancel only before a driver
 * is assigned") is a narrower CUSTOMER rule and lives in `isCancellable`. They used to
 * be the same table, which meant a delivery that failed on the road could not cancel
 * its order at all — the order stayed ON_DELIVERY forever, holding its stock
 * reservation, because the customer-facing restriction was also binding the system.
 */
export enum OrderStatus {
  CREATED = 'CREATED',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  DRIVER_ASSIGNED = 'DRIVER_ASSIGNED',
  PICKED_UP = 'PICKED_UP',
  ON_DELIVERY = 'ON_DELIVERY',
  DELIVERED = 'DELIVERED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  /**
   * A counter sale undone at the till the same day: wrong item, wrong quantity, buyer
   * changed their mind before leaving. Distinct from CANCELLED, which is an order that
   * never happened — a void is a sale that happened and was reversed, and the two must
   * stay tellable apart in the day's book.
   */
  VOIDED = 'VOIDED',
}

/** Legal next states for each status. Empty array = terminal. */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.CREATED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.DRIVER_ASSIGNED, OrderStatus.CANCELLED],
  // CANCELLED stays reachable here so a failed delivery can close its order (and
  // release the stock hold). Customers cannot reach these — see isCancellable.
  // PREPARING is reachable back from every in-flight state: when a delivery is rescheduled
  // (design 3c) the courier is released and the order returns to the dispatch queue for a
  // second attempt. Without it the order stayed pinned to the abandoned attempt's state and
  // could never be assigned or delivered again.
  [OrderStatus.DRIVER_ASSIGNED]: [
    OrderStatus.PICKED_UP,
    OrderStatus.PREPARING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PICKED_UP]: [OrderStatus.ON_DELIVERY, OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.ON_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED],
  // COMPLETED stays terminal even though a counter sale can be voided out of it. The void
  // is NOT an edge here on purpose: an edge would let ANY completed order be voided,
  // including a delivered one, which must go through the refund queue instead. The counter
  // path writes VOIDED directly, the same way a walk-in is born COMPLETED.
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.VOIDED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

/**
 * BR-006: a customer may cancel only before a driver is assigned. Deliberately NOT
 * derived from the transition graph — the system may cancel later than the customer may
 * (e.g. a delivery that failed on the road).
 */
export function isCancellable(status: OrderStatus): boolean {
  return (
    status === OrderStatus.CREATED ||
    status === OrderStatus.CONFIRMED ||
    status === OrderStatus.PREPARING
  );
}

/**
 * Maps a status the order just entered to the customer notification event to fire
 * (FR-093/FR-094), or null when that transition warrants no message. The string values are
 * a contract with crm-service's NotificationEvent enum.
 *
 * B6 changed two answers here, in opposite directions.
 *
 * DRIVER_ASSIGNED used to be silent, filed under "intermediate state". It is not an
 * intermediate state to the customer: it is the exact moment BR-006 ends their own right to
 * cancel. The button simply stopped being there and nothing said why — the one transition
 * where saying nothing costs them something.
 *
 * COMPLETED is now silent when it arrives FROM DELIVERED, because proof of delivery marches
 * the order through both in one loop (delivery.service.ts) and both fired seconds apart.
 * Measured at the door, the customer got three messages: "sudah sampai", "selesai — poin
 * sudah ditambahkan", and POINTS_EARNED carrying the actual number. Two of the three were
 * about points and only one of those knew how many. DELIVERED is the news; POINTS_EARNED is
 * the number; the middle one was neither.
 *
 * `from` is optional so every existing caller keeps its answer — the suppression binds only
 * where the caller can say what the order came from.
 *
 * PREPARING and PICKED_UP stay silent and are right to: ORDER_ON_DELIVERY already carries
 * "it is on its way", which is the part the customer can act on.
 */
export function notificationEventFor(status: OrderStatus, from?: OrderStatus): string | null {
  switch (status) {
    case OrderStatus.CONFIRMED:
      return 'ORDER_CONFIRMED';
    case OrderStatus.DRIVER_ASSIGNED:
      return 'ORDER_DRIVER_ASSIGNED';
    case OrderStatus.ON_DELIVERY:
      return 'ORDER_ON_DELIVERY';
    case OrderStatus.DELIVERED:
      return 'ORDER_DELIVERED';
    case OrderStatus.COMPLETED:
      return from === OrderStatus.DELIVERED ? null : 'ORDER_COMPLETED';
    case OrderStatus.CANCELLED:
      return 'ORDER_CANCELLED';
    // A void is settled face to face at the counter — the buyer is standing there getting
    // their money back. A WhatsApp about it minutes later is noise, not news.
    case OrderStatus.VOIDED:
      return null;
    default:
      return null;
  }
}

/** BR-005: an order is no longer editable once it has been picked up. */
export function isEditable(status: OrderStatus): boolean {
  return (
    status !== OrderStatus.PICKED_UP &&
    status !== OrderStatus.ON_DELIVERY &&
    status !== OrderStatus.DELIVERED &&
    status !== OrderStatus.COMPLETED &&
    status !== OrderStatus.CANCELLED &&
    status !== OrderStatus.VOIDED
  );
}

/**
 * Whether a counter sale may still be undone at the till: same calendar day in the depot's
 * timezone, which is the day the cashier will reconcile.
 *
 * Deliberately not "within N hours". A sale at 21:00 and a sale at 09:00 the next morning
 * are four hours apart but belong to two different drawers, and voiding backwards into a
 * shift somebody already counted and signed off is exactly what this prevents.
 */
export function isVoidableOn(soldAt: Date, now: Date, timeZone: string): boolean {
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone });
  return day(soldAt) === day(now);
}

/**
 * C5 · a counter sale may only be undone into a drawer that is still open, and only if the
 * sale belongs to that drawer.
 *
 * The calendar-day rule above argued it prevented "voiding backwards into a shift somebody
 * already counted and signed off" — and it does not. Two shifts happen in one day all the
 * time: the morning cashier counts, signs off and goes home, and until midnight their sales
 * are still voidable. The reversal lands in the afternoon drawer while the morning's cash
 * total has already been booked, so the depot's cash is overstated by the voided amount and
 * nothing ever reverses it.
 *
 * `openedAt` decides it. No new column and no new call: the endpoint the open-shift guard
 * already hits returns the shift, and the adapter used to throw everything but the id away.
 *
 * Known ceiling, stated rather than papered over: with two shifts open at once at one depot,
 * this permits a cashier to void a sale their colleague rang up after their own shift began.
 * The MONEY still follows the payment's own drawer (C2's `cashierShiftId`), so the reversal
 * is booked against the till that took it; what is not enforced here is who may press the
 * button. Narrowing that needs the sale to record its own shift.
 */
export function isVoidableInShift(soldAt: Date, shiftOpenedAt: Date | null): boolean {
  if (!shiftOpenedAt) return false;
  return soldAt.getTime() >= shiftOpenedAt.getTime();
}
