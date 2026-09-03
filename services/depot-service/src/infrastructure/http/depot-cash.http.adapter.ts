import { Injectable, Logger } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import { DepotCashPort } from '../../application/ports/depot-cash.port';
import { CashTotalUnavailableError } from '../../domain/errors';

/**
 * Reads a depot's PAID cash for a window from payment-service's internal endpoint,
 * authenticated by the shared INTERNAL_SERVICE_KEY (the gateway strips that header inbound,
 * so it only ever travels service-to-service).
 *
 * Fails CLOSED — the opposite of this service's other outbound call. This number decides
 * whether a cashier is short at close; answering 0 because payment-service blinked would
 * book the whole day's takings as a shortfall against a real person.
 */
@Injectable()
export class DepotCashHttpAdapter implements DepotCashPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(DepotCashHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async totalPaidCash(
    depotId: string,
    from: Date,
    to: Date,
    cashierShiftId?: string,
  ): Promise<number> {
    const { paymentServiceUrl, internalServiceKey } = this.config;
    if (!paymentServiceUrl || !internalServiceKey) {
      throw new CashTotalUnavailableError();
    }
    const query = new URLSearchParams({
      depotId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    // C2: naming the shift asks for THIS till, not every till at the depot.
    if (cashierShiftId) query.set('cashierShiftId', cashierShiftId);
    const url = `${paymentServiceUrl}/api/v1/payments/internal/depot-cash?${query.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotCashHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`payment-service responded ${res.status}`);
      }
      const body = (await res.json()) as { total?: number };
      const total = Number(body.total);
      if (!Number.isFinite(total) || total < 0) {
        throw new Error(`payment-service returned an unusable total: ${String(body.total)}`);
      }
      return total;
    } catch (error) {
      this.logger.error(`Depot cash total unavailable for ${depotId}: ${(error as Error).message}`);
      throw new CashTotalUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}
