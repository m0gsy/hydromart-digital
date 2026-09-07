import { Injectable, Logger } from '@nestjs/common';

import { ReferralConfigService } from '../../config/referral-config.service';
import { OrderHistoryPort } from '../../application/ports/order-history.port';

/**
 * Asks order-service whether a customer has ever had an order reach COMPLETED (CA-3-40).
 * System-to-system call authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key).
 *
 * Fails CLOSED — the opposite of its two sibling adapters, deliberately. They answer
 * questions whose worst case is a report showing zeros; this one answers a question whose
 * wrong answer pays out 750 points that cannot be reclaimed. Every failure branch returns
 * `null`, which `redeem()` turns into a 503 the caller can retry, not a silent "yes".
 */
@Injectable()
export class OrderHistoryHttpAdapter implements OrderHistoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(OrderHistoryHttpAdapter.name);

  constructor(private readonly config: ReferralConfigService) {}

  async hasCompletedOrder(customerId: string): Promise<boolean | null> {
    const { internalServiceKey, orderServiceUrl } = this.config;
    if (!internalServiceKey || !orderServiceUrl) {
      this.logger.warn('No order-service url/key; cannot verify new-customer status');
      return null;
    }
    const url = `${orderServiceUrl}/api/v1/orders/internal/customer-completed?customerId=${encodeURIComponent(customerId)}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': internalServiceKey },
        signal: AbortSignal.timeout(OrderHistoryHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`order-service responded ${res.status}`);
      }
      const body = (await res.json()) as { hasCompleted?: unknown };
      // A body that does not carry the boolean is an answer nobody gave. Coercing it would
      // read "no completed orders" and hand out the points.
      return typeof body.hasCompleted === 'boolean' ? body.hasCompleted : null;
    } catch (error) {
      this.logger.warn(`Order history lookup failed: ${(error as Error).message}`);
      return null;
    }
  }
}
