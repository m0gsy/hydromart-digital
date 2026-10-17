import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import {
  CashCollected,
  CashCollectionPort,
  OrderCash,
} from '../../application/ports/cash-collection.port';

/**
 * Reads PAID-cash totals from payment-service's internal POST /payments/internal/cash-collected.
 * A non-2xx response or timeout throws so the settlement fails closed — the
 * expected amount must never be silently understated.
 *
 * Internal route, not the bearer route, on purpose. The order ids are never the caller's: the
 * settlement service derives them from the courier's OWN deliveries inside the shift window,
 * after checking the shift is theirs. The bearer route additionally refuses any order outside
 * the caller's CURRENT depot — which is every order of a shift worked before the courier was
 * moved to another depot — and the courier then met "Could not compute the expected cash
 * total. Please try again." for good, with the cash still in their hands.
 */
@Injectable()
export class CashCollectionHttpAdapter implements CashCollectionPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CashCollectionHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async sumCollected(orderIds: string[], authorization: string): Promise<CashCollected> {
    if (!authorization) {
      throw new Error('missing caller authorization for cash collection');
    }
    if (orderIds.length === 0) {
      return { total: 0, count: 0, byOrder: [] };
    }
    const { paymentServiceUrl, internalServiceKey } = this.config;
    if (!internalServiceKey) {
      throw new Error('INTERNAL_SERVICE_KEY is not configured — cannot read cash collected');
    }
    const url = `${paymentServiceUrl}/api/v1/payments/internal/cash-collected`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CashCollectionHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ orderIds }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payment-service responded ${res.status}`);
      }
      const body = (await res.json()) as Partial<CashCollected>;
      // C1: `byOrder` is what the per-order expectation is computed from. Defaulted to
      // empty rather than assumed present — an older payment-service that does not send
      // it then reads as "no PAID cash on any order", which is the fail-closed direction:
      // the expectation falls back to the COD on the delivery row and no money vanishes.
      const byOrder: OrderCash[] = Array.isArray(body.byOrder)
        ? body.byOrder.map((r) => ({
            orderId: String(r.orderId),
            amountIdr: Number(r.amountIdr ?? 0),
          }))
        : [];
      return { total: Number(body.total ?? 0), count: Number(body.count ?? 0), byOrder };
    } catch (error) {
      this.logger.error(`POST internal/cash-collected failed: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
