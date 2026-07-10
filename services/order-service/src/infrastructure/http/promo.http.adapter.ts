import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { VoucherRejectedError } from '../../domain/errors';
import { PromoPort } from '../../application/ports/promo.port';

/**
 * Talks to the promo-service. `quote` fails CLOSED (rejects checkout if the voucher
 * is invalid or the service is down), forwarding the promo-service's own validation
 * message to the customer. `redeem` fails OPEN and is idempotent on the promo side.
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
    authorization: string,
  ): Promise<{ discount: number }> {
    const url = `${this.config.promoServiceUrl}/api/v1/vouchers/quote`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PromoHttpAdapter.TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify({ code, subtotal }),
        signal: controller.signal,
      });
    } catch (error) {
      this.logger.warn(`Voucher quote unreachable for ${code}: ${(error as Error).message}`);
      throw new VoucherRejectedError('The voucher service is unavailable. Try again shortly.');
    } finally {
      clearTimeout(timer);
    }

    const body = (await res.json().catch(() => ({}))) as { discount?: number; message?: string };
    if (!res.ok) {
      // Surface the promo-service's specific reason (e.g. minimum spend not met).
      throw new VoucherRejectedError(body.message ?? 'This voucher could not be applied.');
    }
    return { discount: body.discount ?? 0 };
  }

  async redeem(
    code: string,
    customerId: string,
    orderId: string,
    subtotal: number,
    authorization: string,
  ): Promise<void> {
    const url = `${this.config.promoServiceUrl}/api/v1/vouchers/redeem`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PromoHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify({ code, customerId, orderId, subtotal }),
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
