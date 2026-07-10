/**
 * Order lifecycle (BR-012). The status graph is strictly forward except that a
 * CANCELLED terminal state is reachable only before a driver is assigned
 * (BR-006). This module is framework-free domain logic — the single source of
 * truth for which transitions are legal.
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
  [OrderStatus.DRIVER_ASSIGNED]: [OrderStatus.PICKED_UP],
  [OrderStatus.PICKED_UP]: [OrderStatus.ON_DELIVERY],
  [OrderStatus.ON_DELIVERY]: [OrderStatus.DELIVERED],
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

/** BR-006: a customer may cancel only while CANCELLED is still a legal transition. */
export function isCancellable(status: OrderStatus): boolean {
  return canTransition(status, OrderStatus.CANCELLED);
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
