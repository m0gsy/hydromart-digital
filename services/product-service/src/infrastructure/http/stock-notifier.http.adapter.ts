import { Injectable, Logger } from '@nestjs/common';

import { ProductConfigService } from '../../config/product-config.service';
import { ProductChanged, StockNotifierPort } from '../../application/ports/stock-notifier.port';

/**
 * Pushes a catalog change to depot-service's internal endpoint, authenticated by the
 * shared INTERNAL_SERVICE_KEY.
 *
 * Never throws, by contract: the catalog edit has already been committed by the time this
 * runs, so a depot-service outage must not surface as a failed save. A missed push leaves
 * stale labels on depot lines, which the next edit repairs.
 */
@Injectable()
export class StockNotifierHttpAdapter implements StockNotifierPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(StockNotifierHttpAdapter.name);

  constructor(private readonly config: ProductConfigService) {}

  async productChanged(change: ProductChanged): Promise<void> {
    const { depotServiceUrl, internalServiceKey } = this.config;
    if (!depotServiceUrl || !internalServiceKey) {
      this.logger.debug(`Stock notify skipped for ${change.productId} (notifier disabled)`);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), StockNotifierHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${depotServiceUrl}/api/v1/inventory/internal/product-changed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify(change),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Stock notify for ${change.productId} failed: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
