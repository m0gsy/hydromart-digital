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

  async getOrderTotal(orderId: string): Promise<number | null> {
    const { orderServiceUrl, internalServiceKey } = this.config;
    if (!orderServiceUrl || !internalServiceKey) {
      return null; // coordination disabled in this environment → skip validation
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OrderCoordinationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(
        `${orderServiceUrl}/api/v1/orders/${orderId}/internal-total`,
        { headers: { 'x-internal-key': internalServiceKey }, signal: controller.signal },
      );
      if (!res.ok) {
        throw new Error(`order-service responded ${res.status}`);
      }
      const body = (await res.json()) as { total?: number };
      if (typeof body.total !== 'number') {
        throw new Error('order-service returned no total');
      }
      return body.total;
      // Fail CLOSED (unlike the notify paths): a failed total fetch throws so we never
      // create a payment at an unvalidated amount.
    } finally {
      clearTimeout(timer);
    }
  }

  async confirmPaid(orderId: string): Promise<void> {
    await this.post(`/api/v1/orders/${orderId}/internal-confirm`, undefined, `Order confirm skipped for ${orderId}`);
  }

  async notifyRefunded(orderId: string, amount: number): Promise<void> {
    await this.post(`/api/v1/orders/${orderId}/internal-refund`, { amount }, `Refund notify skipped for ${orderId}`);
  }

  /** POST to order-service over the internal-key path, failing open (logged, never thrown). */
  private async post(path: string, body: unknown, skipMsg: string): Promise<void> {
    const { orderServiceUrl, internalServiceKey } = this.config;
    if (!orderServiceUrl || !internalServiceKey) {
      return; // feature disabled in this environment
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OrderCoordinationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${orderServiceUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`order-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`${skipMsg}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
