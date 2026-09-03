/**
 * Driver-facing delivery lifecycle (BR-012 subset). Framework-free domain logic.
 * Each active transition maps to the order status the order-service must be
 * advanced to, keeping order-service the single source of truth for BR-012.
 */
export enum DeliveryStatus {
  ASSIGNED = 'ASSIGNED',
  PICKED_UP = 'PICKED_UP',
  ON_DELIVERY = 'ON_DELIVERY',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  // Courier could not deliver but the order lives on for a later attempt (design
  // 3c). Non-active: it frees the driver and does NOT advance the order — dispatch
  // re-assigns it later (ops-side; Delivery.orderId is @unique so it reuses this row).
  RESCHEDULED = 'RESCHEDULED',
}

/** Order statuses the delivery-service drives on order-service (BR-012). */
export type OrderFulfilmentStatus =
  | 'PREPARING'
  | 'DRIVER_ASSIGNED'
  | 'PICKED_UP'
  | 'ON_DELIVERY'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

const TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  [DeliveryStatus.ASSIGNED]: [
    DeliveryStatus.PICKED_UP,
    DeliveryStatus.FAILED,
    DeliveryStatus.RESCHEDULED,
  ],
  [DeliveryStatus.PICKED_UP]: [
    DeliveryStatus.ON_DELIVERY,
    DeliveryStatus.FAILED,
    DeliveryStatus.RESCHEDULED,
  ],
  [DeliveryStatus.ON_DELIVERY]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.FAILED,
    DeliveryStatus.RESCHEDULED,
  ],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.FAILED]: [],
  // Dispatch re-assigns a rescheduled delivery for its second attempt (design 3c).
  [DeliveryStatus.RESCHEDULED]: [DeliveryStatus.ASSIGNED],
};

/** The order status that each delivery status corresponds to, if any. */
const ORDER_STATUS: Partial<Record<DeliveryStatus, OrderFulfilmentStatus>> = {
  [DeliveryStatus.ASSIGNED]: 'DRIVER_ASSIGNED',
  [DeliveryStatus.PICKED_UP]: 'PICKED_UP',
  [DeliveryStatus.ON_DELIVERY]: 'ON_DELIVERY',
  [DeliveryStatus.DELIVERED]: 'DELIVERED',
};

export function canTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * The statuses that occupy a driver, as a list.
 *
 * Named because two readers need the SET and not the predicate: a staff list asking the
 * database for "everything still in flight", and a roster counting what a courier is
 * carrying. Both used to answer it themselves — the tracking board by hardcoding
 * `ON_DELIVERY`, so a delivery a courier had accepted but not picked up was invisible on
 * the one screen that can take it back off them.
 */
export const ACTIVE_STATUSES: readonly DeliveryStatus[] = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.ON_DELIVERY,
];

/** A delivery is active (occupies a driver) until it is delivered or failed. */
export function isActive(status: DeliveryStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function orderStatusFor(status: DeliveryStatus): OrderFulfilmentStatus | null {
  return ORDER_STATUS[status] ?? null;
}
