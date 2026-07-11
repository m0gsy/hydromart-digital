import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { RecommendationCoordinationPort } from '../../application/ports/recommendation-coordination.port';
import { OrderRecord } from '../../application/ports/order.repository';

/**
 * Feeds a completed order to recommendation-service's ingest endpoint. Fails OPEN:
 * any error (recommendation-service down, non-2xx, missing config) logs and returns,
 * so completing an order is never blocked. Disabled (no-op) when either the URL or
 * the shared internal key is blank. Ingestion is idempotent on the recommendation
 * side (keyed by orderId), so a retry is safe.
 */
@Injectable()
export class RecommendationCoordinationHttpAdapter implements RecommendationCoordinationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(RecommendationCoordinationHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async recordCompleted(order: OrderRecord): Promise<void> {
    const baseUrl = this.config.recommendationServiceUrl;
    const key = this.config.internalServiceKey;
    if (!baseUrl || !key) {
      return;
    }
    const url = `${baseUrl}/api/v1/recommendations/ingest`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      RecommendationCoordinationHttpAdapter.TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({
          orderId: order.id,
          customerId: order.customerId,
          depotId: order.depotId,
          items: order.items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            sku: i.sku,
            unit: i.unit,
          })),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`recommendation-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Recommendation ingest skipped for order ${order.id}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
