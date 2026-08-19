import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import {
  ResellerDiscount,
  ResellerDiscountPort,
} from '../../application/ports/reseller-discount.port';

/**
 * Reads a customer's reseller pricing from customer-service.
 *
 * Two reads, two failure directions on purpose (A5/A6):
 *
 * - `get` (checkout) forwards the customer's own bearer to `/resellers/me` and fails OPEN —
 *   ordering water must not depend on customer-service being up. It now reports WHY it
 *   answered nothing, so the caller can mark the order (A5): "charged full price" and
 *   "charged full price because a read failed" used to be indistinguishable.
 * - `getFor` (counter) reads the internal route on the shared key and fails CLOSED. It used
 *   to forward the CASHIER's bearer to `/resellers/:id`, and `resellerView` lists neither
 *   KEPALA_DEPOT nor STAFF_DEPOT — measured: both 403 — so the catch-all below turned every
 *   agen at a till into "not a reseller" and charged them retail, behind one logger.warn.
 */
@Injectable()
export class ResellerDiscountHttpAdapter implements ResellerDiscountPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ResellerDiscountHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async get(authorization: string): Promise<ResellerDiscount | null> {
    if (!authorization) return null;
    try {
      return await this.read('/api/v1/resellers/me', { authorization });
    } catch (error) {
      // A5: fail open, but never silently. The caller marks the order so a full-price
      // charge that came from an outage is distinguishable from one that was correct.
      this.logger.error(`Reseller pricing unavailable at checkout: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Counter sale, by named buyer, over the internal key — NOT the cashier's bearer.
   *
   * Throws on a read failure. Null means one thing only: customer-service answered 404,
   * "this customer is not an agen".
   */
  async getFor(customerId: string): Promise<ResellerDiscount | null> {
    const key = this.config.internalServiceKey;
    if (!key) {
      // A6's silent-release trap: with no key every call 401s, the counter goes back to
      // charging every agen retail, and nothing anywhere goes red. Loud, and fail-closed.
      throw new Error('INTERNAL_SERVICE_KEY is not set — counter agen pricing cannot be read');
    }
    return this.read(`/api/v1/customers/internal/reseller/${customerId}`, { 'x-internal-key': key });
  }

  private async read(
    path: string,
    headers: Record<string, string>,
  ): Promise<ResellerDiscount | null> {
    const url = `${this.config.customerServiceUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ResellerDiscountHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      if (res.status === 404) return null; // not a reseller
      if (!res.ok) {
        throw new Error(`customer-service responded ${res.status}`);
      }
      const body = (await res.json()) as {
        active?: boolean;
        discountPct?: number;
        flatGallonPriceIdr?: number;
        homeDepotId?: string;
      };
      const discountPct = Number(body.discountPct);
      if (!Number.isFinite(discountPct)) return null;
      // Absent on a customer-service that predates the column — 0 is "price by percent",
      // which is what those rows meant anyway, so an old peer is not a pricing surprise.
      const flat = Number(body.flatGallonPriceIdr);
      return {
        active: body.active === true,
        discountPct,
        flatGallonPriceIdr: Number.isFinite(flat) && flat > 0 ? flat : 0,
        // A9. Absent from `/resellers/me` on a peer that predates the field; the caller
        // treats null as "cannot prove which depot" and declines to price cross-depot.
        homeDepotId: typeof body.homeDepotId === 'string' ? body.homeDepotId : null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
