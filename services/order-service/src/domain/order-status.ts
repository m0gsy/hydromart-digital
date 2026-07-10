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
