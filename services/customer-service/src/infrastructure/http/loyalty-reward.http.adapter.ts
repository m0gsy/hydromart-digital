import { Injectable, Logger } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import { LoyaltyRewardPort } from '../../application/ports/loyalty-reward.port';

/**
 * Awards loyalty points on loyalty-service for the birthday promo (FR-091). System-to-system
 * call authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key). THROWS on any
 * failure (loyalty down, non-2xx, missing config/key) so the sweep leaves that customer
 * un-stamped and retries on the next run. The caller's per-year stamp prevents double grants.
 */
@Injectable()
export class LoyaltyRewardHttpAdapter implements LoyaltyRewardPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(LoyaltyRewardHttpAdapter.name);

  constructor(private readonly config: CustomerConfigService) {}

  async reward(
    customerId: string,
    points: number,
    reason: string,
    _authorization: string,
  ): Promise<void> {
    const base = this.config.loyaltyServiceUrl;
    const { internalServiceKey } = this.config;
    if (!base) throw new Error('LOYALTY_SERVICE_URL not configured');
    if (!internalServiceKey) throw new Error('INTERNAL_SERVICE_KEY not configured');

    const res = await fetch(`${base}/api/v1/loyalty/reward`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
      body: JSON.stringify({ customerId, points, reason }),
      signal: AbortSignal.timeout(LoyaltyRewardHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.warn(`loyalty reward failed for ${customerId}: ${res.status}`);
      throw new Error(`loyalty-service responded ${res.status}`);
    }
  }
}
