import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { LoyaltyCoordinationPort } from '../../application/ports/loyalty-coordination.port';

/**
 * Awards points on the loyalty-service when an order completes (BR-013). System-to-system
 * call authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key). Fails OPEN: any
 * error (loyalty down, non-2xx, no key) logs and returns, so completing an order is never
 * blocked by loyalty. Earning is idempotent on the loyalty side, so a retried completion
 * will not double-award.
 */
@Injectable()
export class LoyaltyCoordinationHttpAdapter implements LoyaltyCoordinationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(LoyaltyCoordinationHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async awardPoints(
    customerId: string,
    orderId: string,
    subtotal: number,
    _authorization: string,
  ): Promise<void> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.warn(`No internal service key; skipped loyalty award for order ${orderId}`);
      return;
    }
    const url = `${this.config.loyaltyServiceUrl}/api/v1/loyalty/earn`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LoyaltyCoordinationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ customerId, orderId, subtotal }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`loyalty-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Loyalty award skipped for order ${orderId}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
