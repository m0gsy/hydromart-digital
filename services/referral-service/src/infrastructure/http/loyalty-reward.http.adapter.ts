import { Injectable, Logger } from '@nestjs/common';

import { ReferralConfigService } from '../../config/referral-config.service';
import { LoyaltyRewardPort } from '../../application/ports/loyalty-reward.port';

/**
 * Awards loyalty points on the loyalty-service when a referral qualifies (FR-092).
 * System-to-system call authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key).
 * Fails OPEN: any error (loyalty down, non-2xx, no key) logs a warning and returns, so
 * qualification is never blocked by loyalty. The reward is called exactly once — inside
 * the referral's PENDING->QUALIFIED transition — so there is no double-award on retry.
 */
@Injectable()
export class LoyaltyRewardHttpAdapter implements LoyaltyRewardPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(LoyaltyRewardHttpAdapter.name);

  constructor(private readonly config: ReferralConfigService) {}

  async reward(
    customerId: string,
    points: number,
    reason: string,
    _authorization: string,
  ): Promise<void> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.warn(`No internal service key; skipped loyalty reward for customer ${customerId}`);
      return;
    }
    const url = `${this.config.loyaltyServiceUrl}/api/v1/loyalty/reward`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ customerId, points, reason }),
        signal: AbortSignal.timeout(LoyaltyRewardHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`loyalty-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Loyalty reward skipped for customer ${customerId}: ${(error as Error).message}`,
      );
    }
  }
}
