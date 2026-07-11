import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { ReferralCoordinationPort } from '../../application/ports/referral-coordination.port';

/**
 * Qualifies a referral on the referral-service when an order completes (FR-092).
 * System-to-system call authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key).
 * Fails OPEN: any error (referral down, non-2xx, no key) logs and returns, so completing
 * an order is never blocked. Qualification is idempotent on the referral side (a customer
 * is referred at most once), so retries are safe.
 */
@Injectable()
export class ReferralCoordinationHttpAdapter implements ReferralCoordinationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ReferralCoordinationHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async qualify(customerId: string, orderId: string, _authorization: string): Promise<void> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.warn(`No internal service key; skipped referral qualify for order ${orderId}`);
      return;
    }
    const url = `${this.config.referralServiceUrl}/api/v1/referrals/qualify`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ReferralCoordinationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ customerId, orderId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`referral-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Referral qualify skipped for order ${orderId}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
