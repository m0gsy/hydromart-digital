import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import {
  DepotPrice,
  DepotPriceLookup,
  DepotPricingPort,
} from '../../application/ports/depot-pricing.port';

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

  async getPrices(
    depotId: string,
    productIds: string[],
    quantities: number[] = [],
  ): Promise<DepotPriceLookup> {
    const prices = new Map<string, DepotPrice>();
    if (productIds.length === 0) {
      return { prices, unavailable: false };
    }
    const query = encodeURIComponent(productIds.join(','));
    const qty =
      quantities.length > 0 ? `&quantities=${encodeURIComponent(quantities.join(','))}` : '';
    const url = `${this.config.depotServiceUrl}/api/v1/depots/${depotId}/inventory/prices?productIds=${query}${qty}`;
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
        tierPrice?: number;
      }[];
      for (const row of body) {
        prices.set(row.productId, {
          ...(typeof row.sellPrice === 'number' ? { sellPrice: row.sellPrice } : {}),
          ...(row.adjustType ? { adjustType: row.adjustType, value: row.value ?? 0 } : {}),
          ...(typeof row.tierPrice === 'number' ? { tierPrice: row.tierPrice } : {}),
        });
      }
    } catch (error) {
      this.logger.warn(
        `Depot price lookup skipped for depot ${depotId}: ${(error as Error).message}`,
      );
      // Still fail open — but say so, so the order carries the fact that it was priced
      // from the catalog rather than from the depot.
      return { prices, unavailable: true };
    } finally {
      clearTimeout(timer);
    }
    return { prices, unavailable: false };
  }
}
