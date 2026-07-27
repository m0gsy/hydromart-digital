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
}

/** Legal next states for each status. Empty array = terminal. */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.CREATED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.DRIVER_ASSIGNED, OrderStatus.CANCELLED],
  // CANCELLED stays reachable here so a failed delivery can close its order (and
  // release the stock hold). Customers cannot reach these — see isCancellable.
  [OrderStatus.DRIVER_ASSIGNED]: [OrderStatus.PICKED_UP, OrderStatus.CANCELLED],
  [OrderStatus.PICKED_UP]: [OrderStatus.ON_DELIVERY, OrderStatus.CANCELLED],
  [OrderStatus.ON_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
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
 * (FR-093/FR-094), or null when that transition warrants no message. The string
 * values are a contract with crm-service's NotificationEvent enum. Intermediate
 * states (PREPARING, DRIVER_ASSIGNED, PICKED_UP) and CREATED are intentionally silent.
 */
export function notificationEventFor(status: OrderStatus): string | null {
  switch (status) {
    case OrderStatus.CONFIRMED:
      return 'ORDER_CONFIRMED';
    case OrderStatus.ON_DELIVERY:
      return 'ORDER_ON_DELIVERY';
    case OrderStatus.DELIVERED:
      return 'ORDER_DELIVERED';
    case OrderStatus.COMPLETED:
      return 'ORDER_COMPLETED';
    case OrderStatus.CANCELLED:
      return 'ORDER_CANCELLED';
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
    status !== OrderStatus.CANCELLED
  );
}
