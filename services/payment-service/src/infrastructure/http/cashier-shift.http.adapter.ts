import { Injectable, Logger } from '@nestjs/common';

import { CashierShiftPort } from '../../application/ports/cashier-shift.port';
import { PaymentConfigService } from '../../config/payment-config.service';

/**
 * Reads the caller's open shift from depot-service, with the caller's OWN bearer — so the
 * answer is "the drawer this cashier has open", not "some drawer at this depot".
 *
 * Fails SOFT (null). See the port for why: the goods are already gone by the time this
 * runs, and a payment attributed by the old window rule beats no payment record at all.
 */
@Injectable()
export class CashierShiftHttpAdapter implements CashierShiftPort {
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(CashierShiftHttpAdapter.name);

  constructor(private readonly config: PaymentConfigService) {}

  async openShiftId(depotId: string, authorization: string): Promise<string | null> {
    const base = this.config.depotServiceUrl;
    if (!base || !authorization) return null;
    const url = `${base}/api/v1/cashier-shifts/current?depotId=${encodeURIComponent(depotId)}`;
    try {
      const res = await fetch(url, {
        headers: { authorization },
        signal: AbortSignal.timeout(CashierShiftHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`open-shift lookup responded ${res.status}; payment left unattributed`);
        return null;
      }
      // `null` is a real answer: the caller is simply not on the counter.
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      return body?.id ?? null;
    } catch (error) {
      this.logger.warn(`open-shift lookup failed: ${(error as Error).message}; payment left unattributed`);
      return null;
    }
  }
}
