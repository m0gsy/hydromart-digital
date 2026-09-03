import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { OrderPaymentPort, OrderPaymentSnapshot } from '../../application/ports/order-payment.port';

/**
 * Reads an order's payment from payment-service's internal twin of the staff route.
 *
 * Internal key, not the caller's bearer: the whole point is that two of the roles allowed
 * to dispatch cannot read payments, so forwarding their token would reproduce the 403 this
 * exists to remove.
 *
 * Fails CLOSED — every path here throws rather than returning null. A null would be read as
 * "no payment row", which is exactly the wrong answer for an unreachable service: the
 * courier would be sent out to collect nothing on a cash sale. A blank key or URL is a
 * misconfiguration, and `.env.example` already states the rule for that key: blank =
 * fail-closed.
 */
@Injectable()
export class OrderPaymentHttpAdapter implements OrderPaymentPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(OrderPaymentHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  /**
   * CA-4-03. payment-service's own `internal/void-for-order`, which already means exactly
   * this: reverse a payment whose cash has just been handed back in person, straight to
   * REFUNDED with no approval queue. Reused rather than reinvented — the alternative
   * (`cancel-for-order`) routes through the HQ approval threshold, which is right for a
   * cancellation nobody is standing at, and wrong for money already back in a customer's
   * hand.
   */
  async reverseCash(orderId: string, reason: string, changedBy: string): Promise<void> {
    const { internalServiceKey, paymentServiceUrl } = this.config;
    if (!internalServiceKey || !paymentServiceUrl) {
      throw new Error('payment reversal is not configured (INTERNAL_SERVICE_KEY)');
    }
    const url = `${paymentServiceUrl}/api/v1/payments/internal/void-for-order`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OrderPaymentHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-internal-key': internalServiceKey,
        },
        body: JSON.stringify({ orderId, reason, changedBy }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payment-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.error(`cash reversal failed for order ${orderId}: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async forOrder(orderId: string): Promise<OrderPaymentSnapshot | null> {
    const { internalServiceKey, paymentServiceUrl } = this.config;
    if (!internalServiceKey || !paymentServiceUrl) {
      throw new Error('payment lookup is not configured (INTERNAL_SERVICE_KEY)');
    }
    const url = `${paymentServiceUrl}/api/v1/payments/internal/for-order/${orderId}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OrderPaymentHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payment-service responded ${res.status}`);
      }
      const body = (await res.json()) as {
        items?: { method?: string; amount?: number; status?: string }[];
      };
      const first = body.items?.[0];
      // No payment row is a real answer (an order can be dispatched before one exists);
      // a row with no method or amount is not, so it is refused like an outage.
      if (!first) return null;
      if (typeof first.method !== 'string' || typeof first.amount !== 'number') {
        throw new Error('payment-service returned a payment with no method/amount');
      }
      // CA-4-03: `status` is refused on the same terms as the other two. Defaulting a
      // missing status to PENDING would say "the courier is not holding the money" about
      // an order that may well be PAID, and defaulting it to PAID would invent a debt.
      // Neither is a guess this may make — the caller decides whether cash is outstanding.
      if (typeof first.status !== 'string') {
        throw new Error('payment-service returned a payment with no status');
      }
      return { method: first.method, amount: first.amount, status: first.status };
    } catch (error) {
      this.logger.error(`payment lookup failed for order ${orderId}: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
