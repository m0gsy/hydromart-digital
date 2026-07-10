import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { ReferralCoordinationPort } from '../../application/ports/referral-coordination.port';

/**
 * Qualifies a referral on the referral-service when an order completes (FR-092).
 * Fails OPEN: any error (referral down, non-2xx, missing token) logs and returns,
 * so completing an order is never blocked. Qualification is idempotent on the
 * referral side (a customer is referred at most once), so retries are safe.
 */
@Injectable()
export class ReferralCoordinationHttpAdapter implements ReferralCoordinationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ReferralCoordinationHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async qualify(customerId: string, orderId: string, authorization: string): Promise<void> {
    if (!authorization) {
      this.logger.warn(`No caller token; skipped referral qualify for order ${orderId}`);
      return;
    }
    const url = `${this.config.referralServiceUrl}/api/v1/referrals/qualify`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ReferralCoordinationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
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
