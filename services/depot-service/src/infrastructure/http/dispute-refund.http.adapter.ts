import { Injectable, Logger } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import { DisputeRefundUnavailableError } from '../../domain/errors';
import { DisputeRefundPort } from '../../application/ports/dispute-refund.port';

/**
 * Three hops, because a dispute records a human order NUMBER and a refund needs a payment.
 *
 *   orderRef ("HM-260902-001")  →  order-service   →  order id
 *   order id                    →  payment-service →  the payment
 *   payment                     →  payment-service →  refund queued
 *
 * CA-2-39. The manager's own bearer travels the whole way rather than an internal key:
 * `Can('refundIssue')` then applies to the person who pressed the button, the refund is
 * attributed to them, and a manager who may not issue refunds is refused. Deciding that
 * with a service key would let depot-service grant a capability nobody gave it.
 *
 * **Fails CLOSED at every hop.** A dispute marked "refunded" against an order nobody could
 * find, or a payment nobody could refund, is exactly the state CA-2-39 is about. The
 * operator is told while they are still on the screen, and each refusal keeps its own
 * message — "order not found" and "already refunded" are different problems and an
 * operator can act on the difference.
 */
@Injectable()
export class DisputeRefundHttpAdapter implements DisputeRefundPort {
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(DisputeRefundHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async request(orderRef: string, reason: string, authorization: string): Promise<void> {
    const { orderServiceUrl, paymentServiceUrl } = this.config;
    if (!orderServiceUrl || !paymentServiceUrl) {
      throw new DisputeRefundUnavailableError('integrasi refund belum dikonfigurasi');
    }
    if (!authorization) {
      // Without the caller's token the refund would have to be issued as somebody else, or
      // not at all. Not at all is the honest answer.
      throw new DisputeRefundUnavailableError('sesi tidak terbaca, refund tidak diminta');
    }

    const orderId = await this.findOrderId(orderServiceUrl, orderRef, authorization);
    const paymentId = await this.findPaymentId(paymentServiceUrl, orderId, authorization);

    const res = await this.get(
      `${paymentServiceUrl}/api/v1/payments/${paymentId}/refund`,
      authorization,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
    if (!res.ok) {
      throw new DisputeRefundUnavailableError(await this.why(res, 'refund ditolak'));
    }
    this.logger.log(`Refund queued for order ${orderRef} (payment ${paymentId}): ${reason}`);
  }

  /** The order behind the number the operator typed. Exact match only — see the note. */
  private async findOrderId(base: string, orderRef: string, auth: string): Promise<string> {
    const url = `${base}/api/v1/orders/manage?orderNumber=${encodeURIComponent(orderRef)}&limit=10`;
    const res = await this.get(url, auth);
    if (!res.ok)
      throw new DisputeRefundUnavailableError(await this.why(res, 'pesanan tidak terbaca'));
    const page = (await res.json()) as { items?: { id: string; orderNumber: string }[] };
    /*
     * `orderNumber` is a SUBSTRING search on that endpoint (audit F-12), so a typed
     * reference can match several orders. Refunding the first of them would be picking one
     * at random with somebody's money, so only an exact match counts.
     */
    const exact = (page.items ?? []).filter((o) => o.orderNumber === orderRef);
    if (exact.length !== 1) {
      throw new DisputeRefundUnavailableError(
        exact.length === 0
          ? `pesanan ${orderRef} tidak ditemukan`
          : `nomor ${orderRef} cocok dengan ${exact.length} pesanan`,
      );
    }
    return exact[0]!.id;
  }

  /** The payment to refund. A cash-on-delivery order that was never paid has none. */
  private async findPaymentId(base: string, orderId: string, auth: string): Promise<string> {
    const res = await this.get(`${base}/api/v1/payments/for-order/${orderId}`, auth);
    if (!res.ok) {
      throw new DisputeRefundUnavailableError(await this.why(res, 'pembayaran tidak terbaca'));
    }
    const body = (await res.json()) as { items?: { id: string; status: string }[] };
    const paid = (body.items ?? []).filter((p) => p.status === 'PAID');
    if (paid.length === 0) {
      throw new DisputeRefundUnavailableError('pesanan ini belum ada pembayaran yang lunas');
    }
    // Newest first is what the endpoint returns; the last PAID payment is the one the
    // customer's money is sitting in.
    return paid[0]!.id;
  }

  private get(url: string, auth: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: auth },
      signal: AbortSignal.timeout(DisputeRefundHttpAdapter.TIMEOUT_MS),
    });
  }

  /** The other service's own message when it sent one — it is more use than a status code. */
  private async why(res: Response, fallback: string): Promise<string> {
    try {
      const body = (await res.json()) as { message?: string };
      return body.message ? String(body.message) : `${fallback} (${res.status})`;
    } catch {
      return `${fallback} (${res.status})`;
    }
  }
}
