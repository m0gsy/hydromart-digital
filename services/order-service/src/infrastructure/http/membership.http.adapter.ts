import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { MembershipPort } from '../../application/ports/membership.port';

/**
 * Reads the caller's loyalty account from the loyalty-service to obtain their
 * membership tier discount rate (FR-032). Fails OPEN: any error (loyalty down,
 * non-2xx, missing token, malformed rate) returns 0, so a missing membership
 * discount never blocks checkout. The customer's own token is forwarded, so
 * `/loyalty/me` resolves to their account, and the fulfilling depot is passed so
 * loyalty answers against that depot's membership ladder.
 */
@Injectable()
export class MembershipHttpAdapter implements MembershipPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(MembershipHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async getDiscountRate(authorization: string, depotId: string | null = null): Promise<number> {
    if (!authorization) return 0;
    const scope = depotId ? `?depotId=${encodeURIComponent(depotId)}` : '';
    const url = `${this.config.loyaltyServiceUrl}/api/v1/loyalty/me${scope}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MembershipHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`loyalty-service responded ${res.status}`);
      }
      const body = (await res.json()) as { discountRate?: number };
      const rate = Number(body.discountRate);
      // Clamp to a sane range; anything unexpected degrades to no discount.
      return Number.isFinite(rate) && rate > 0 && rate < 1 ? rate : 0;
    } catch (error) {
      this.logger.warn(`Membership discount unavailable: ${(error as Error).message}`);
      return 0;
    } finally {
      clearTimeout(timer);
    }
  }
}
