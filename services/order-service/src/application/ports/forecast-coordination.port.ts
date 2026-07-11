import { OrderRecord } from './order.repository';

/**
 * Feeds a completed order into the forecast-service ingest model (per-product,
 * per-depot demand history). Non-critical to fulfilment, so implementations fail
 * OPEN: a failure must never block completing an order. Ingestion is idempotent on
 * the forecast-service side (keyed by orderId), so a retried completion is safe.
 */
export interface ForecastCoordinationPort {
  ingestCompletedOrder(order: OrderRecord): Promise<void>;
}
