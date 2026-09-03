import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import {
  CashVarianceChargedEvent,
  CourierPaidEarnings,
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
    // The earning push stays fail-open: the delivery is already made, and refusing to
    // record it because payout is down would undo a handover that physically happened.
    await this.post('courier/ledger/internal', event, `earning ${event.deliveryId}`);
  }

  /**
   * CA-2-32: unlike the earning push above, this one REPORTS whether it landed. A charge
   * the courier's ledger never received must not be recorded on the settlement as made.
   */
  async cashVarianceCharged(event: CashVarianceChargedEvent): Promise<boolean> {
    return this.post('courier/ledger/variance/internal', event, `variance ${event.settlementId}`);
  }

  /**
   * Reads the paid earnings behind a depot's commission report (E-1).
   *
   * Unlike the pushes above this does NOT fail open: a null tells the report to say it
   * could not be produced. Answering it with a locally configured rate is how two numbers
   * for the same delivery came to exist in the first place.
   */
  async paidEarnings(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<CourierPaidEarnings[] | null> {
    const { payoutServiceUrl, internalServiceKey } = this.config;
    if (!payoutServiceUrl || !internalServiceKey) {
      this.logger.warn('Courier earnings read skipped: payout integration is not configured');
      return null;
    }
    const query = new URLSearchParams({
      depotId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const url = `${payoutServiceUrl}/api/v1/courier/ledger/internal/depot-earnings?${query}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CourierPayoutHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payout-service responded ${res.status}`);
      }
      const body = (await res.json()) as { couriers?: CourierPaidEarnings[] };
      // A 200 with no `couriers` is an answer we cannot read, not a depot that paid nobody.
      return Array.isArray(body.couriers) ? body.couriers : null;
    } catch (error) {
      this.logger.warn(`Courier earnings read failed for ${depotId}: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fires an internal payout push. Never throws — it answers TRUE when payout-service
   * accepted it and FALSE otherwise, and each caller decides what a false means for it.
   */
  private async post(path: string, body: unknown, ref: string): Promise<boolean> {
    const { payoutServiceUrl, internalServiceKey } = this.config;
    if (!payoutServiceUrl || !internalServiceKey) {
      this.logger.debug(`Courier payout push skipped (payout integration disabled): ${ref}`);
      return false;
    }
    const url = `${payoutServiceUrl}/api/v1/${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CourierPayoutHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payout-service responded ${res.status}`);
      }
      return true;
    } catch (error) {
      this.logger.warn(`Courier payout push failed for ${ref}: ${(error as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
