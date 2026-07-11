import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { DepotPrice, DepotPricingPort } from '../../application/ports/depot-pricing.port';

/**
 * Fetches per-depot price overrides from the depot-service public price endpoint.
 * Fails OPEN: any error (depot-service down, non-2xx, timeout) returns an empty map,
 * so checkout falls back to catalog base prices rather than blocking the order.
 */
@Injectable()
export class DepotPricingHttpAdapter implements DepotPricingPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(DepotPricingHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async getPrices(depotId: string, productIds: string[]): Promise<Map<string, DepotPrice>> {
    const prices = new Map<string, DepotPrice>();
    if (productIds.length === 0) {
      return prices;
    }
    const query = encodeURIComponent(productIds.join(','));
    const url = `${this.config.depotServiceUrl}/api/v1/depots/${depotId}/inventory/prices?productIds=${query}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotPricingHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
      const body = (await res.json()) as {
        productId: string;
        sellPrice?: number;
        adjustType?: 'PERCENT' | 'FIXED';
        value?: number;
      }[];
      for (const row of body) {
        prices.set(row.productId, {
          ...(typeof row.sellPrice === 'number' ? { sellPrice: row.sellPrice } : {}),
          ...(row.adjustType ? { adjustType: row.adjustType, value: row.value ?? 0 } : {}),
        });
      }
    } catch (error) {
      this.logger.warn(
        `Depot price lookup skipped for depot ${depotId}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
    return prices;
  }
}
