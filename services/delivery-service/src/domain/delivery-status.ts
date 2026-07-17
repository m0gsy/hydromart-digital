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
export type OrderFulfilmentStatus = 'DRIVER_ASSIGNED' | 'PICKED_UP' | 'ON_DELIVERY' | 'DELIVERED';

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
  [DeliveryStatus.RESCHEDULED]: [],
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

/** A delivery is active (occupies a driver) until it is delivered or failed. */
export function isActive(status: DeliveryStatus): boolean {
  return (
    status === DeliveryStatus.ASSIGNED ||
    status === DeliveryStatus.PICKED_UP ||
    status === DeliveryStatus.ON_DELIVERY
  );
}

export function orderStatusFor(status: DeliveryStatus): OrderFulfilmentStatus | null {
  return ORDER_STATUS[status] ?? null;
}
