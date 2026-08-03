import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { CashierShiftPort } from '../../application/ports/cashier-shift.port';

/**
 * Reads the caller's own open shift from depot-service, forwarding their token — the answer
 * is deliberately about the person holding it, not about the depot in general.
 *
 * Fails CLOSED: an unreadable answer is treated as "no shift", so the sale is refused
 * rather than booked into a drawer nobody has claimed.
 */
@Injectable()
export class CashierShiftHttpAdapter implements CashierShiftPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CashierShiftHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async hasOpenShift(depotId: string, authorization: string): Promise<boolean> {
    if (!this.config.depotServiceUrl || !authorization) return false;
    const url = `${this.config.depotServiceUrl}/api/v1/cashier-shifts/current?depotId=${encodeURIComponent(depotId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CashierShiftHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { authorization },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
      // `null` is a real answer here: the caller is simply not on the counter.
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      return !!body?.id;
    } catch (error) {
      this.logger.warn(`Open-shift check failed for depot ${depotId}: ${(error as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
