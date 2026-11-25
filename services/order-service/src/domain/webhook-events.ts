import { randomUUID } from 'node:crypto';

/** HD-17B: the events an order raises (contracts/ai-v1/events.openapi.json). */
export const ORDER_CREATED = 'order.created';
export const ORDER_STATUS_CHANGED = 'order.status_changed';

export interface WebhookEventRow {
  event: string;
  eventId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

interface OrderFacts {
  id: string;
  depotId: string | null;
  isWalkIn: boolean;
}

/** No personal data on purpose: ids, the depot, the channel and statuses only. */
function base(order: OrderFacts, status: string, at: Date): Record<string, unknown> {
  return {
    orderId: order.id,
    depotId: order.depotId,
    channel: order.isWalkIn ? 'WALK_IN' : 'ONLINE',
    status,
    occurredAt: at.toISOString(),
  };
}

export function orderCreatedEvent(order: OrderFacts, status: string, at: Date): WebhookEventRow {
  return {
    event: ORDER_CREATED,
    eventId: `${ORDER_CREATED}:${order.id}`,
    payload: base(order, status, at),
    occurredAt: at,
  };
}

/**
 * One event per transition. `transitionId` is the id of the status-history row written in the
 * same transaction, so the key is unique per transition even when an order revisits a status.
 */
export function orderStatusChangedEvent(
  order: OrderFacts,
  from: string,
  to: string,
  transitionId: string,
  at: Date,
): WebhookEventRow {
  return {
    event: ORDER_STATUS_CHANGED,
    eventId: `${ORDER_STATUS_CHANGED}:${order.id}:${transitionId}`,
    payload: { ...base(order, to, at), from, to },
    occurredAt: at,
  };
}

/** A fresh id for a status-history row, so its event can name it before the row exists. */
export function newTransitionId(): string {
  return randomUUID();
}
