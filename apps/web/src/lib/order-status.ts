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
  // Not "cancelled": this sale happened and was reversed at the till. The two have to stay
  // tellable apart wherever an order is shown.
  VOIDED: 'Voided at the counter',
};

export function statusLabel(status: OrderStatus): string {
  return LABELS[status];
}

/** Progress through the fulfilment flow as a 0..1 fraction. */
export function statusProgress(status: OrderStatus): number {
  if (status === 'CANCELLED' || status === 'VOIDED') return 0;
  const idx = ORDER_FLOW.indexOf(status);
  if (idx < 0) return 0;
  return (idx + 1) / ORDER_FLOW.length;
}

/** BR-006: a customer may cancel only before a driver is assigned. */
export function isCancellable(status: OrderStatus): boolean {
  return status === 'CREATED' || status === 'CONFIRMED' || status === 'PREPARING';
}

/**
 * K2.4: mirrors the server rule. BR-006 read the status alone, and a rescheduled order is
 * back on PREPARING — so an order whose goods already left the depot showed its customer a
 * cancel button again, and pressing it released stock that had physically moved. The right
 * ends when the goods leave; the history is where that survives a second attempt.
 */
export function hasBeenDispatched(history: readonly { status: OrderStatus }[] = []): boolean {
  return history.some(
    (h) => h.status === 'DRIVER_ASSIGNED' || h.status === 'PICKED_UP' || h.status === 'ON_DELIVERY',
  );
}

/**
 * H10. The window that opens the moment BR-006 closes: a courier is holding the order and
 * the customer can no longer stop it themselves, but the depot still can.
 *
 * This exists because the cancel button simply DISAPPEARED at that boundary — no line
 * saying why, nothing offered in its place — on the exact screen someone opens when they
 * have realised a mistake, at the exact moment the mistake starts costing a delivery run.
 * The rule is unchanged; what it needed was a name, so the screen can say it out loud.
 */
export function isDepotOnlyCancel(status: OrderStatus): boolean {
  return status === 'DRIVER_ASSIGNED' || status === 'PICKED_UP' || status === 'ON_DELIVERY';
}

/** The next status in the fulfilment flow, or null at the end / for CANCELLED. */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  const idx = ORDER_FLOW.indexOf(status);
  if (idx < 0 || idx >= ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[idx + 1] ?? null;
}

/**
 * Whether depot staff may advance this order manually.
 *
 * The depot prep steps (accept → prepare) are staff-driven here; driver assignment and
 * everything up to the handover is owned by delivery-service, so the queue offers nothing
 * in between.
 *
 * B1 adds the far end. `DELIVERED → COMPLETED` had no human trigger at all: the only path
 * was delivery-service's fail-open loop, which breaks on the first failure and writes a log
 * line, so an order whose DELIVERED landed and whose COMPLETED did not sat there forever —
 * no stock consume, no points, no franchise revenue, and no button anywhere.
 *
 * That case is gated on the SERVER's answer (`order.staffCanComplete`), not on the status,
 * because it depends on a per-depot setting an operator can change without a deploy. The
 * screen reflects the rule; it does not keep a second copy of it.
 */
export function staffCanAdvance(status: OrderStatus, staffCanComplete = false): boolean {
  if (status === 'DELIVERED') return staffCanComplete;
  return status === 'CREATED' || status === 'CONFIRMED';
}

/** Whether an order still needs the customer to pay. */
export function tone(status: OrderStatus): 'active' | 'done' | 'cancelled' {
  // A void reads as cancelled here on purpose: both are off-track and neither is revenue.
  // The distinction that matters lives in the label, not the colour.
  if (status === 'CANCELLED' || status === 'VOIDED') return 'cancelled';
  if (status === 'COMPLETED' || status === 'DELIVERED') return 'done';
  return 'active';
}
