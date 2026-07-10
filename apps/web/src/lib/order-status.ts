import type { OrderStatus } from './types';

// The forward fulfilment sequence (BR-012). CANCELLED is terminal and off-track.
export const ORDER_FLOW: OrderStatus[] = [
  'CREATED',
  'CONFIRMED',
  'PREPARING',
  'DRIVER_ASSIGNED',
  'PICKED_UP',
  'ON_DELIVERY',
  'DELIVERED',
  'COMPLETED',
];

const LABELS: Record<OrderStatus, string> = {
  CREATED: 'Order placed',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  DRIVER_ASSIGNED: 'Driver assigned',
  PICKED_UP: 'Picked up',
  ON_DELIVERY: 'On the way',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function statusLabel(status: OrderStatus): string {
  return LABELS[status];
}

/** Progress through the fulfilment flow as a 0..1 fraction. */
export function statusProgress(status: OrderStatus): number {
  if (status === 'CANCELLED') return 0;
  const idx = ORDER_FLOW.indexOf(status);
  if (idx < 0) return 0;
  return (idx + 1) / ORDER_FLOW.length;
}

/** BR-006: a customer may cancel only before a driver is assigned. */
export function isCancellable(status: OrderStatus): boolean {
  return status === 'CREATED' || status === 'CONFIRMED' || status === 'PREPARING';
}

/** The next status in the fulfilment flow, or null at the end / for CANCELLED. */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  const idx = ORDER_FLOW.indexOf(status);
  if (idx < 0 || idx >= ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[idx + 1] ?? null;
}

/**
 * Whether depot staff may advance this order manually. Only the depot prep steps
 * (accept → prepare) are staff-driven here; driver assignment and everything after
 * is owned by delivery-service, so the queue stops offering advance at PREPARING.
 */
export function staffCanAdvance(status: OrderStatus): boolean {
  return status === 'CREATED' || status === 'CONFIRMED';
}

/** Whether an order still needs the customer to pay. */
export function tone(status: OrderStatus): 'active' | 'done' | 'cancelled' {
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'COMPLETED' || status === 'DELIVERED') return 'done';
  return 'active';
}
