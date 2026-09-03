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
    depotId?: string | null,
  ): Promise<{ discount: number; discountType?: string }> {
    return this.postQuote(
      `${this.config.promoServiceUrl}/api/v1/vouchers/quote`,
      { authorization },
      // CA-2-65: `depotId` has to be ON THE WIRE, not merely in the signature. The
      // parameter is optional, so nothing in the type system would have noticed it being
      // dropped here — and a depot-scoped voucher would have gone on spending everywhere
      // while every layer above looked correct.
      { code, subtotal, shippingFee, depotId },
      code,
    );
  }

  async quoteFor(
    code: string,
    customerId: string,
    subtotal: number,
    shippingFee: number,
    depotId?: string | null,
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
      { code, customerId, subtotal, shippingFee, depotId },
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
    //
    // E-5: this was `body.discount ?? 0`. A 200 whose body carries no readable discount is
    // not a voucher worth nothing — it is a quote we could not read, and silently pricing
    // it at zero charges the customer full price for a voucher the screen accepted. Every
    // other unreadable answer on this path rejects; so does this one.
    const discount = Number(body.discount);
    if (!Number.isFinite(discount) || discount < 0) {
      this.logger.warn(`Voucher quote for ${code} carried no readable discount`);
      throw new VoucherRejectedError('This voucher could not be applied.');
    }
    return { discount, discountType: body.discountType };
  }

  async redeem(
    code: string,
    customerId: string,
    orderId: string,
    subtotal: number,
    shippingFee: number,
    _authorization: string,
    depotId?: string | null,
  ): Promise<void> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.error(`Refusing to honour a voucher for order ${orderId}: no internal key`);
      throw new VoucherRejectedError();
    }
    const url = `${this.config.promoServiceUrl}/api/v1/vouchers/redeem`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PromoHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ code, customerId, orderId, subtotal, shippingFee, depotId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`promo-service responded ${res.status}`);
      }
    } catch (error) {
      // B-6: this used to swallow the failure — "idempotent on the promo side; a failed
      // record only under-counts usage". It does not just under-count: the order was
      // already created WITH the discount applied, so a failed burn handed the customer
      // money off and left the voucher live and reusable, indefinitely. The burn is what
      // makes the discount legitimate, so failing to burn must fail the checkout.
      this.logger.error(`Voucher redeem failed for order ${orderId}: ${(error as Error).message}`);
      throw new VoucherRejectedError();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * C4: hand the voucher back on a void. Fails OPEN — see the port for why the asymmetry
   * with `redeem` is deliberate rather than an oversight.
   */
  async release(orderId: string): Promise<void> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.error(`Voucher for voided order ${orderId} not released: no internal key`);
      return;
    }
    const url = `${this.config.promoServiceUrl}/api/v1/vouchers/release`;
    try {
      // `AbortSignal.timeout` rather than a controller plus a `setTimeout` callback: the
      // callback is a function nothing ever invokes in a passing test, and the deadline is
      // the only thing it was there for.
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ orderId }),
        signal: AbortSignal.timeout(PromoHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`promo-service responded ${res.status}`);
    } catch (error) {
      this.logger.error(
        `Voucher release failed for voided order ${orderId}: ${(error as Error).message}`,
      );
    }
  }
}
