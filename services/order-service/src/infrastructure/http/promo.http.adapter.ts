import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { VoucherRejectedError } from '../../domain/errors';
import { PromoPort } from '../../application/ports/promo.port';

/**
 * Talks to the promo-service. `quote` fails CLOSED (rejects checkout if the voucher
 * is invalid or the service is down), forwarding the customer's token + the promo
 * message. `redeem` is a system-to-system call authenticated by the shared
 * INTERNAL_SERVICE_KEY (x-internal-key); it fails OPEN and is idempotent on the promo side.
 */
@Injectable()
export class PromoHttpAdapter implements PromoPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(PromoHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async quote(
    code: string,
    _customerId: string,
    subtotal: number,
    shippingFee: number,
    authorization: string,
  ): Promise<{ discount: number; discountType?: string }> {
    return this.postQuote(
      `${this.config.promoServiceUrl}/api/v1/vouchers/quote`,
      { authorization },
      { code, subtotal, shippingFee },
      code,
    );
  }

  async quoteFor(
    code: string,
    customerId: string,
    subtotal: number,
    shippingFee: number,
  ): Promise<{ discount: number; discountType?: string }> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      // Fail CLOSED like every other quote failure: a counter sale must not silently drop
      // the buyer's voucher and charge full price because a key is missing.
      this.logger.warn(`Voucher quote skipped for ${code}: no internal service key`);
      throw new VoucherRejectedError('The voucher service is unavailable. Try again shortly.');
    }
    return this.postQuote(
      `${this.config.promoServiceUrl}/api/v1/vouchers/quote/internal`,
      { 'x-internal-key': internalServiceKey },
      { code, customerId, subtotal, shippingFee },
      code,
    );
  }

  /** The one wire call behind both quotes — same fail-closed contract, different caller identity. */
  private async postQuote(
    url: string,
    auth: Record<string, string>,
    payload: Record<string, unknown>,
    code: string,
  ): Promise<{ discount: number; discountType?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PromoHttpAdapter.TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      this.logger.warn(`Voucher quote unreachable for ${code}: ${(error as Error).message}`);
      throw new VoucherRejectedError('The voucher service is unavailable. Try again shortly.');
    } finally {
      clearTimeout(timer);
    }

    const body = (await res.json().catch(() => ({}))) as {
      discount?: number;
      discountType?: string;
      message?: string;
    };
    if (!res.ok) {
      // Surface the promo-service's specific reason (e.g. minimum spend not met).
      throw new VoucherRejectedError(body.message ?? 'This voucher could not be applied.');
    }
    // discountType decides which ceiling the discount is capped against at checkout
    // (value vs delivery fee) — promo-service already returns it on every quote.
    return { discount: body.discount ?? 0, discountType: body.discountType };
  }

  async redeem(
    code: string,
    customerId: string,
    orderId: string,
    subtotal: number,
    shippingFee: number,
    _authorization: string,
  ): Promise<void> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.warn(`Voucher redeem skipped for order ${orderId}: no internal service key`);
      return;
    }
    const url = `${this.config.promoServiceUrl}/api/v1/vouchers/redeem`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PromoHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ code, customerId, orderId, subtotal, shippingFee }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`promo-service responded ${res.status}`);
      }
    } catch (error) {
      // Idempotent on the promo side; a failed record only under-counts usage.
      this.logger.warn(`Voucher redeem skipped for order ${orderId}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
