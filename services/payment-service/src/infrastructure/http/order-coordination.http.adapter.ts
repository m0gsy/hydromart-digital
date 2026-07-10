import { Injectable, Logger } from '@nestjs/common';

import { OrderCoordinationPort } from '../../application/ports/order-coordination.port';
import { PaymentConfigService } from '../../config/payment-config.service';

/**
 * Confirms an order via order-service's system-to-system endpoint, authenticated by the
 * shared INTERNAL_SERVICE_KEY. Fails OPEN: a blank order URL/key disables it and any error
 * is swallowed — a settled payment must never fail because the order-confirm callback did.
 */
@Injectable()
export class OrderCoordinationHttpAdapter implements OrderCoordinationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(OrderCoordinationHttpAdapter.name);

  constructor(private readonly config: PaymentConfigService) {}

  async confirmPaid(orderId: string): Promise<void> {
    const { orderServiceUrl, internalServiceKey } = this.config;
    if (!orderServiceUrl || !internalServiceKey) {
      return; // feature disabled in this environment
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OrderCoordinationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${orderServiceUrl}/api/v1/orders/${orderId}/internal-confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`order-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Order confirm skipped for ${orderId}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
