import { OrderRecord } from './order.repository';

/**
 * Feeds a completed order into the recommendation-service read model (co-buy /
 * reorder / trending). Non-critical to fulfilment, so implementations fail OPEN:
 * a failure must never block completing an order. Ingestion is idempotent on the
 * recommendation-service side, so a retried completion will not double-count.
 */
export interface RecommendationCoordinationPort {
  recordCompleted(order: OrderRecord): Promise<void>;
}
