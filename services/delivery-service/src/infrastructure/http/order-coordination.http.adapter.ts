import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { OrderFulfilmentStatus } from '../../domain/delivery-status';
import {
  OrderAdvanceMeta,
  OrderCoordinationPort,
} from '../../application/ports/order-coordination.port';

/**
 * Advances an order on the order-service via its staff status endpoint,
 * forwarding the caller's bearer token so order-service enforces BR-012 RBAC.
 * A non-2xx response throws so the delivery action fails closed.
 */
@Injectable()
export class OrderCoordinationHttpAdapter implements OrderCoordinationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(OrderCoordinationHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async advanceStatus(
    orderId: string,
    status: OrderFulfilmentStatus,
    authorization: string,
    meta?: OrderAdvanceMeta,
  ): Promise<void> {
    if (!authorization) {
      throw new Error('missing caller authorization for order coordination');
    }
    const url = `${this.config.orderServiceUrl}/api/v1/orders/${orderId}/status`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OrderCoordinationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization,
        },
        body: JSON.stringify({
          status,
          ...(meta?.driverName ? { driverName: meta.driverName } : {}),
          ...(meta?.driverPhone ? { driverPhone: meta.driverPhone } : {}),
          ...(meta?.estimatedArrivalAt
            ? { estimatedArrivalAt: meta.estimatedArrivalAt.toISOString() }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        /*
         * A REFUSED transition and an unreachable service are two different facts, and the
         * caller has to be able to tell them apart. order-service answers 409 when the
         * order has already left the status this transition was built on — somebody else
         * got there first — and 422 when the transition itself is not legal. Both mean
         * "retrying will not help"; a timeout or a 500 means the opposite.
         *
         * Carried as a flag on the error rather than a delivery-domain error, because this
         * adapter must not know what the service above it calls a lost race.
         */
        throw Object.assign(new Error(`order-service responded ${res.status}`), {
          refused: res.status === 409 || res.status === 422,
        });
      }
    } catch (error) {
      this.logger.error(`PATCH order ${orderId} → ${status} failed: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
