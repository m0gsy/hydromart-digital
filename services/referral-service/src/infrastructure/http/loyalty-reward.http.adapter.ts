import { Injectable, Logger } from '@nestjs/common';

import { ReferralConfigService } from '../../config/referral-config.service';
import { LoyaltyRewardPort } from '../../application/ports/loyalty-reward.port';

/**
 * Awards loyalty points on the loyalty-service when a referral qualifies (FR-092).
 * System-to-system call authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key).
 * Errors propagate to the order outbox; the key makes retries safe if a response is lost.
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
    idempotencyKey: string,
  ): Promise<void> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      throw new Error(`No internal service key for loyalty reward of customer ${customerId}`);
    }
    const url = `${this.config.loyaltyServiceUrl}/api/v1/loyalty/reward`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ customerId, points, reason, idempotencyKey }),
        signal: AbortSignal.timeout(LoyaltyRewardHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`loyalty-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Loyalty reward failed for customer ${customerId}: ${(error as Error).message}`);
      throw error;
    }
  }
}
