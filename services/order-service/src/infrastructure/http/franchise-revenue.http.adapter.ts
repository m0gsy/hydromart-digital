import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import {
  FranchiseRevenuePort,
  OrderRevenueEvent,
} from '../../application/ports/franchise-revenue.port';

/**
 * Pushes a completed order to payout-service's internal revenue endpoint, keyed by the
 * shared INTERNAL_SERVICE_KEY (the gateway strips that header on inbound requests, so it
 * only ever travels service-to-service). Mirrors delivery-service's courier earning push.
 *
 * Fails OPEN: a blank payout URL / internal key (integration disabled) or any payout error
 * logs and returns. Payout keys the entry on the order id, so re-pushing is safe.
 */
@Injectable()
export class FranchiseRevenueHttpAdapter implements FranchiseRevenuePort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(FranchiseRevenueHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async orderCompleted(event: OrderRevenueEvent): Promise<void> {
    const { payoutServiceUrl, internalServiceKey } = this.config;
    if (!payoutServiceUrl || !internalServiceKey) {
      this.logger.debug(
        `Franchise revenue push skipped (payout integration disabled): ${event.orderNumber}`,
      );
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FranchiseRevenueHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${payoutServiceUrl}/api/v1/payout/revenue/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          orderId: event.orderId,
          orderNumber: event.orderNumber,
          franchiseOwnerId: event.franchiseOwnerId,
          depotId: event.depotId,
          amountIdr: event.amountIdr,
          commissionBaseIdr: event.commissionBaseIdr,
          completedAt: event.completedAt,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payout-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Franchise revenue push failed for ${event.orderNumber}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async orderVoided(orderId: string, reason: string): Promise<void> {
    const { payoutServiceUrl, internalServiceKey } = this.config;
    if (!payoutServiceUrl || !internalServiceKey) {
      this.logger.debug(`Franchise revenue reversal skipped (payout disabled): ${orderId}`);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FranchiseRevenueHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${payoutServiceUrl}/api/v1/payout/revenue/internal/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ orderId, reason }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payout-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Franchise revenue reversal failed for ${orderId}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
