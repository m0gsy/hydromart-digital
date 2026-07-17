import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import {
  CourierPayoutPort,
  DeliveryCompletedEvent,
} from '../../application/ports/courier-payout.port';

/**
 * Posts a completed delivery to payout-service's internal earning endpoint, keyed by
 * the shared INTERNAL_SERVICE_KEY. Fails OPEN: a blank payout URL / internal key (dev
 * default) or any payout error logs and returns — the delivery is already recorded,
 * and the push is idempotent (payout re-uses the delivery id), so a retry is safe.
 */
@Injectable()
export class CourierPayoutHttpAdapter implements CourierPayoutPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CourierPayoutHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async deliveryCompleted(event: DeliveryCompletedEvent): Promise<void> {
    const { payoutServiceUrl, internalServiceKey } = this.config;
    if (!payoutServiceUrl || !internalServiceKey) {
      this.logger.debug('Courier earning push skipped (payout integration disabled)');
      return;
    }
    const url = `${payoutServiceUrl}/api/v1/courier/ledger/internal`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CourierPayoutHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payout-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Courier earning push failed for ${event.deliveryId}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
