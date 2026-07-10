import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { OrderFulfilmentStatus } from '../../domain/delivery-status';
import { OrderCoordinationPort } from '../../application/ports/order-coordination.port';

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
        body: JSON.stringify({ status }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`order-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.error(`PATCH order ${orderId} → ${status} failed: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
