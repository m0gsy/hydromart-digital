import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { OrderCashRow, PaymentCashPort } from '../../application/ports/payment-cash.port';

/**
 * Reads the cash side of a depot's day from payment-service's internal routes.
 *
 * Fails SOFT (null, never 0) — unlike `PaymentReversalHttpAdapter`, which fails closed
 * because it moves money. This one only reports on money already moved, and a daily report
 * that refuses to render because one service blinked is worse than one that says "—".
 *
 * `cashByOrder` is a POST for its body, not a query string: a busy depot's day is hundreds
 * of order ids, which is past what a URL can carry safely.
 */
@Injectable()
export class PaymentCashHttpAdapter implements PaymentCashPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(PaymentCashHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async cashByOrder(orderIds: string[]): Promise<OrderCashRow[] | null> {
    if (orderIds.length === 0) return [];
    const body = await this.call<{ byOrder?: OrderCashRow[] }>(
      'internal/cash-collected',
      'courier COD',
      { method: 'POST', body: JSON.stringify({ orderIds }) },
    );
    if (!body) return null;
    return Array.isArray(body.byOrder) ? body.byOrder : [];
  }

  async depotCash(depotId: string, from: Date, to: Date): Promise<number | null> {
    const query = `depotId=${encodeURIComponent(depotId)}&from=${from.toISOString()}&to=${to.toISOString()}`;
    const body = await this.call<{ total?: number }>(
      `internal/depot-cash?${query}`,
      'counter cash',
      { method: 'GET' },
    );
    if (!body) return null;
    return typeof body.total === 'number' ? Math.round(body.total) : 0;
  }

  private async call<T>(
    path: string,
    what: string,
    init: { method: string; body?: string },
  ): Promise<T | null> {
    const { internalServiceKey, paymentServiceUrl } = this.config;
    if (!internalServiceKey || !paymentServiceUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PaymentCashHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${paymentServiceUrl}/api/v1/payments/${path}`, {
        method: init.method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-internal-key': internalServiceKey,
        },
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payment-service responded ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (error) {
      this.logger.warn(`Daily ${what} unavailable: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
