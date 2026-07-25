import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { ResellerDiscount, ResellerDiscountPort } from '../../application/ports/reseller-discount.port';

/**
 * Reads the checking-out customer's reseller pricing from customer-service
 * (`GET /api/v1/resellers/me`) so checkout can apply agen pricing. Fails
 * OPEN: any error (customer-service down, non-2xx, missing token, malformed
 * body, 404 = not a reseller) returns null, so reseller pricing is never a
 * hard checkout dependency. The customer's own token is forwarded, so
 * `/resellers/me` resolves to their account.
 */
@Injectable()
export class ResellerDiscountHttpAdapter implements ResellerDiscountPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ResellerDiscountHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async get(authorization: string): Promise<ResellerDiscount | null> {
    if (!authorization) return null;
    const url = `${this.config.customerServiceUrl}/api/v1/resellers/me`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ResellerDiscountHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization },
        signal: controller.signal,
      });
      if (res.status === 404) return null; // not a reseller
      if (!res.ok) {
        throw new Error(`customer-service responded ${res.status}`);
      }
      const body = (await res.json()) as { active?: boolean; discountPct?: number };
      const discountPct = Number(body.discountPct);
      if (!Number.isFinite(discountPct)) return null;
      return { active: body.active === true, discountPct };
    } catch (error) {
      this.logger.warn(`Reseller pricing unavailable: ${(error as Error).message}`);
      return null; // fail open
    } finally {
      clearTimeout(timer);
    }
  }
}
