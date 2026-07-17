import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { RatingPort, RatingSummary } from '../../application/ports/rating.port';

/**
 * Batch-reads the mean order rating from order-service's internal endpoint, keyed by
 * the shared INTERNAL_SERVICE_KEY. Fails OPEN — a blank internal key (dev default) or
 * any order-service error returns a null average, which the 4c card shows as "—".
 */
@Injectable()
export class RatingHttpAdapter implements RatingPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(RatingHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async avgRating(orderIds: string[]): Promise<RatingSummary> {
    const empty: RatingSummary = { average: null, count: 0 };
    if (orderIds.length === 0) return empty;
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.debug('Rating read skipped (internal key not configured)');
      return empty;
    }
    const url = `${this.config.orderServiceUrl}/api/v1/orders/reviews/ratings/internal`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RatingHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ orderIds }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`order-service responded ${res.status}`);
      }
      const body = (await res.json()) as RatingSummary;
      return {
        average: body.average === null ? null : Number(body.average),
        count: Number(body.count ?? 0),
      };
    } catch (error) {
      this.logger.warn(`Rating read failed: ${(error as Error).message}`);
      return empty;
    } finally {
      clearTimeout(timer);
    }
  }
}
