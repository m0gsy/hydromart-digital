import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { DeliverySlaPort } from '../../application/ports/delivery-sla.port';

/**
 * Reads one depot's on-time rate from delivery-service's internal report route.
 *
 * Fails SOFT (null): the monthly review is a report, and one that refuses to render because
 * a sibling service blinked is worse than one that says "—" in a single cell. `slaRate` is 0
 * when nothing was delivered, which is a real number about a real month but NOT a
 * percentage anybody should read — so an empty window comes back as null too.
 */
@Injectable()
export class DeliverySlaHttpAdapter implements DeliverySlaPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(DeliverySlaHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async onTimeRate(depotId: string, from: Date, to: Date): Promise<number | null> {
    const { internalServiceKey, deliveryServiceUrl } = this.config;
    if (!internalServiceKey || !deliveryServiceUrl) return null;
    const query = `depotIds=${encodeURIComponent(depotId)}&from=${from.toISOString()}&to=${to.toISOString()}`;
    const url = `${deliveryServiceUrl}/api/v1/reports/internal/sla?${query}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DeliverySlaHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`delivery-service responded ${res.status}`);
      }
      const body = (await res.json()) as { slaRate?: number; totalDelivered?: number };
      if (!body.totalDelivered || typeof body.slaRate !== 'number') return null;
      return body.slaRate;
    } catch (error) {
      this.logger.warn(`SLA unavailable for depot ${depotId}: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
