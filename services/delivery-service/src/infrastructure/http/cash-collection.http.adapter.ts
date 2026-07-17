import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { CashCollected, CashCollectionPort } from '../../application/ports/cash-collection.port';

/**
 * Reads PAID-cash totals from payment-service's GET /payments/cash-collected,
 * forwarding the caller's bearer so payment-service enforces the settlement RBAC.
 * A non-2xx response or timeout throws so the settlement fails closed — the
 * expected amount must never be silently understated.
 */
@Injectable()
export class CashCollectionHttpAdapter implements CashCollectionPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CashCollectionHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async sumCollected(orderIds: string[], authorization: string): Promise<CashCollected> {
    if (!authorization) {
      throw new Error('missing caller authorization for cash collection');
    }
    if (orderIds.length === 0) {
      return { total: 0, count: 0 };
    }
    const query = new URLSearchParams({ orderIds: orderIds.join(',') });
    const url = `${this.config.paymentServiceUrl}/api/v1/payments/cash-collected?${query}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CashCollectionHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payment-service responded ${res.status}`);
      }
      const body = (await res.json()) as CashCollected;
      return { total: Number(body.total ?? 0), count: Number(body.count ?? 0) };
    } catch (error) {
      this.logger.error(`GET cash-collected failed: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
