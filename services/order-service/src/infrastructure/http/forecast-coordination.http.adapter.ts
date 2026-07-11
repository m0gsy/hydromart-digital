import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { ForecastCoordinationPort } from '../../application/ports/forecast-coordination.port';
import { OrderRecord } from '../../application/ports/order.repository';

/**
 * Feeds a completed order to forecast-service's ingest endpoint. Fails OPEN:
 * any error (forecast-service down, non-2xx, missing config) logs and returns,
 * so completing an order is never blocked. Disabled (no-op) when either the URL or
 * the shared internal key is blank. Ingestion is idempotent on the forecast side
 * (keyed by orderId), so a retry is safe.
 */
@Injectable()
export class ForecastCoordinationHttpAdapter implements ForecastCoordinationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ForecastCoordinationHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async ingestCompletedOrder(order: OrderRecord): Promise<void> {
    const baseUrl = this.config.forecastServiceUrl;
    const key = this.config.internalServiceKey;
    if (!baseUrl || !key) {
      return;
    }
    const url = `${baseUrl}/api/v1/forecast/ingest`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      ForecastCoordinationHttpAdapter.TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({
          orderId: order.id,
          customerId: order.customerId,
          depotId: order.depotId,
          total: Math.round(order.total),
          items: order.items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            sku: i.sku,
            unit: i.unit,
            quantity: i.quantity,
          })),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`forecast-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Forecast ingest skipped for order ${order.id}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
