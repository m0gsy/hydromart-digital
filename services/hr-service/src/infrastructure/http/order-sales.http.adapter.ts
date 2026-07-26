import { Injectable, Logger } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import { SalesPort } from '../../application/ports/sales.port';

/**
 * Fetches per-depot fulfilled sales from order-service's internal endpoint. Fails SOFT:
 * any error / missing config → null, so a payroll run never blocks and SALES rules simply
 * don't fire on an unknown figure (never a fabricated 0).
 */
@Injectable()
export class OrderSalesHttpAdapter implements SalesPort {
  private readonly logger = new Logger(OrderSalesHttpAdapter.name);

  constructor(private readonly config: HrConfigService) {}

  async depotSales(depotId: string, from: Date, to: Date): Promise<number | null> {
    const { url, internalKey } = this.config.orderService;
    if (!url || !internalKey) return null;
    const qs = new URLSearchParams({ depotId, from: from.toISOString(), to: to.toISOString() });
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/orders/api/v1/orders/internal/depot-sales?${qs}`, {
        headers: { 'x-internal-key': internalKey },
      });
      if (!res.ok) {
        this.logger.warn(`depot-sales ${res.status} for depot ${depotId}`);
        return null;
      }
      const body = (await res.json()) as { totalIdr?: number };
      return typeof body.totalIdr === 'number' ? body.totalIdr : null;
    } catch (err) {
      this.logger.warn(`depot-sales fetch failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
