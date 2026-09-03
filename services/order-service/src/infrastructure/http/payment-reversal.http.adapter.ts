import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { PaymentReversalPort } from '../../application/ports/payment-reversal.port';
import { PaymentReversalFailedError } from '../../domain/errors';

/**
 * Reverses a counter sale's payment through payment-service's internal endpoint,
 * authenticated by the shared INTERNAL_SERVICE_KEY.
 *
 * The service path, not the cashier's token, is deliberate: `refundIssue` excludes the
 * person who took the cash, so a token-based refund would need a manager standing at the
 * depot before any buyer could get their money back.
 *
 * Fails CLOSED — the only outbound call in this service that does, alongside the voucher
 * quote. Everything else here is a side effect of an order; this IS the money.
 */
@Injectable()
export class PaymentReversalHttpAdapter implements PaymentReversalPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(PaymentReversalHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  voidForOrder(orderId: string, reason: string): Promise<void> {
    return this.post('void-for-order', orderId, reason);
  }

  /**
   * K2.3: the cancellation counterpart. A separate endpoint rather than a flag, because
   * the two differ in the one way that matters — a counter void settles immediately with
   * no approval, a cancellation goes through the HQ refund threshold like any other refund.
   */
  cancelForOrder(orderId: string, reason: string): Promise<void> {
    return this.post('cancel-for-order', orderId, reason);
  }

  private async post(route: string, orderId: string, reason: string): Promise<void> {
    const { internalServiceKey, paymentServiceUrl } = this.config;
    if (!internalServiceKey || !paymentServiceUrl) {
      this.logger.error(`Payment reversal unavailable for order ${orderId}: not configured`);
      throw new PaymentReversalFailedError();
    }
    const url = `${paymentServiceUrl}/api/v1/payments/internal/${route}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PaymentReversalHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ orderId, reason }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payment-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.error(
        `Payment reversal failed for order ${orderId}: ${(error as Error).message}`,
      );
      throw new PaymentReversalFailedError();
    } finally {
      clearTimeout(timer);
    }
  }
}
