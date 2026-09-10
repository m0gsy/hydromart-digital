import { ForbiddenException, Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { ClaimableOrder, OrderLookupPort } from '../../application/ports/order-lookup.port';

/**
 * Reads one order through order-service's staff by-id route, carrying the COURIER'S OWN
 * bearer rather than the internal key.
 *
 * That choice IS the depot gate. `GET /orders/manage/:id` is `@Can('orderQueue')` followed
 * by `assertDepotAccess(user, order.depotId)`, and STAFF_DEPOT is in `orderQueue` — so a
 * courier reaching for an order outside their own depot is refused by order-service before
 * this service sees the row. Using the internal key here would authenticate as the system
 * principal, bypass both, and oblige this service to grow its own copy of a rule that
 * already exists next door.
 *
 * The three answers are kept apart, because a courier who reads "coba lagi" after being
 * refused will keep trying: 403 is "not your depot", 404 is "no such order", and anything
 * else throws.
 */
@Injectable()
export class OrderLookupHttpAdapter implements OrderLookupPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(OrderLookupHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async findForClaim(orderId: string, authorization: string): Promise<ClaimableOrder | null> {
    if (!authorization) {
      throw new Error('missing caller authorization for order lookup');
    }
    const url = `${this.config.orderServiceUrl}/api/v1/orders/manage/${orderId}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OrderLookupHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { authorization }, signal: controller.signal });
      if (res.status === 404) return null;
      if (res.status === 403) {
        throw new ForbiddenException('Pesanan ini bukan milik depot Anda.');
      }
      if (!res.ok) {
        throw new Error(`order-service responded ${res.status}`);
      }
      return (await res.json()) as ClaimableOrder;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      this.logger.error(`GET order ${orderId} for claim failed: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
