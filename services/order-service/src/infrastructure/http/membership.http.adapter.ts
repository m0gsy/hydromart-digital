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
    return this.read(this.url('me', depotId), { authorization });
  }

  /**
   * The buyer's rate on a counter sale. The call carries the cashier's token, so /me would
   * answer with the cashier's own tier — the buyer has to be named. Internal key, same
   * fail-open contract.
   */
  async getDiscountRateFor(customerId: string, depotId: string | null = null): Promise<number> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) return 0;
    return this.read(this.url(`accounts/${encodeURIComponent(customerId)}`, depotId), {
      'x-internal-key': internalServiceKey,
    });
  }

  private url(path: string, depotId: string | null): string {
    const scope = depotId ? `?depotId=${encodeURIComponent(depotId)}` : '';
    return `${this.config.loyaltyServiceUrl}/api/v1/loyalty/${path}${scope}`;
  }

  private async read(url: string, headers: Record<string, string>): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MembershipHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
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
