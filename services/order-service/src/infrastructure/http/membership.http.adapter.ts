import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { MembershipPort, MembershipRate } from '../../application/ports/membership.port';

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

  async getDiscountRate(
    authorization: string,
    depotId: string | null = null,
  ): Promise<MembershipRate> {
    // No token = a guest, not an outage. Nothing was asked because there was nobody to ask
    // about, and 0 is the honest answer rather than a fallback.
    if (!authorization) return { rate: 0, unavailable: false };
    return this.read(this.url('me', depotId), { authorization });
  }

  /**
   * The buyer's rate on a counter sale. The call carries the cashier's token, so /me would
   * answer with the cashier's own tier — the buyer has to be named. Internal key, same
   * fail-open contract.
   */
  async getDiscountRateFor(
    customerId: string,
    depotId: string | null = null,
  ): Promise<MembershipRate> {
    const { internalServiceKey } = this.config;
    // Unlike the missing token above, a missing internal key IS an outage: the path exists
    // and is misconfigured, so the buyer's tier went unread.
    if (!internalServiceKey) return { rate: 0, unavailable: true };
    return this.read(this.url(`accounts/${encodeURIComponent(customerId)}`, depotId), {
      'x-internal-key': internalServiceKey,
    });
  }

  private url(path: string, depotId: string | null): string {
    const scope = depotId ? `?depotId=${encodeURIComponent(depotId)}` : '';
    return `${this.config.loyaltyServiceUrl}/api/v1/loyalty/${path}${scope}`;
  }

  private async read(url: string, headers: Record<string, string>): Promise<MembershipRate> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MembershipHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`loyalty-service responded ${res.status}`);
      }
      const body = (await res.json()) as { discountRate?: number };
      const rate = Number(body.discountRate);
      // Clamp to a sane range; anything unexpected degrades to no discount. A read that
      // arrived and said "no discount" is a fact, so it is not marked unavailable — only a
      // rate we never got is.
      return {
        rate: Number.isFinite(rate) && rate > 0 && rate < 1 ? rate : 0,
        unavailable: false,
      };
    } catch (error) {
      this.logger.warn(`Membership discount unavailable: ${(error as Error).message}`);
      return { rate: 0, unavailable: true };
    } finally {
      clearTimeout(timer);
    }
  }
}
