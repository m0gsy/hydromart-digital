import { Injectable, Logger } from '@nestjs/common';

import { isTaxRounding } from '@hydromart/platform';

import { OrderConfigService } from '../../config/order-config.service';
import { TaxRate, TaxRatePort } from '../../application/ports/tax-rate.port';

/**
 * Reads the PPN rate from payment-service's internal route.
 *
 * Cached for five minutes, and a stale value outlives a failed refresh: the rate changes a few
 * times a year, every checkout asks for it, and the answer to "payment-service blinked" is the
 * last rate we knew, not "no tax". Never throws; null only when no rate has ever been read.
 */
@Injectable()
export class TaxRateHttpAdapter implements TaxRatePort {
  private static readonly TTL_MS = 5 * 60_000;
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(TaxRateHttpAdapter.name);
  private cached: { rate: TaxRate; at: number } | null = null;

  constructor(private readonly config: OrderConfigService) {}

  async current(): Promise<TaxRate | null> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < TaxRateHttpAdapter.TTL_MS) return this.cached.rate;
    const { internalServiceKey, paymentServiceUrl } = this.config;
    if (!internalServiceKey || !paymentServiceUrl) return this.cached?.rate ?? null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TaxRateHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${paymentServiceUrl}/api/v1/tax-settings/internal/rate`, {
        headers: { accept: 'application/json', 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`payment-service responded ${res.status}`);
      const body = (await res.json()) as { ppnPercent?: unknown; taxRounding?: unknown };
      const percent = Number(body.ppnPercent);
      if (!Number.isFinite(percent) || percent < 0 || !isTaxRounding(body.taxRounding)) {
        throw new Error('unreadable tax rate');
      }
      const rate: TaxRate = { percent, rounding: body.taxRounding };
      this.cached = { rate, at: now };
      return rate;
    } catch (error) {
      this.logger.warn(
        `PPN rate unavailable, using ${this.cached ? 'the last one' : 'none'}: ${(error as Error).message}`,
      );
      return this.cached?.rate ?? null;
    } finally {
      clearTimeout(timer);
    }
  }
}
