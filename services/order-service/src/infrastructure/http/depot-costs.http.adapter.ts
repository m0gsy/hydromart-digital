import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { DepotCostsPort } from '../../application/ports/depot-costs.port';

/**
 * The two cost reads behind the monthly review's net profit: goods + till from
 * depot-service, payroll from hr-service.
 *
 * One adapter for two services because it is one question — "what did this depot spend
 * last month" — and splitting it across two ports would let a caller fetch half of a P&L
 * and think it had one.
 *
 * Fails SOFT per source (null). The SERVICE is what refuses to publish a partial profit;
 * this layer's job is only to say honestly which half it could not get.
 */
@Injectable()
export class DepotCostsHttpAdapter implements DepotCostsPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(DepotCostsHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async costs(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<{ cogsIdr: number; opexIdr: number } | null> {
    const query = `depotId=${encodeURIComponent(depotId)}&from=${from.toISOString()}&to=${to.toISOString()}`;
    const body = await this.get<{ cogsIdr?: number; opexIdr?: number }>(
      this.config.depotServiceUrl,
      `/api/v1/cashbook/internal/depot-costs?${query}`,
      `depot costs for ${depotId}`,
    );
    if (!body) return null;
    return { cogsIdr: Math.round(body.cogsIdr ?? 0), opexIdr: Math.round(body.opexIdr ?? 0) };
  }

  async payroll(depotId: string, periodMonth: string): Promise<number | null> {
    const query = `depotId=${encodeURIComponent(depotId)}&periodMonth=${encodeURIComponent(periodMonth)}`;
    const body = await this.get<{ payrollMtdNet?: number }>(
      this.config.hrServiceUrl,
      `/api/v1/hr-reports/internal/depot-summary?${query}`,
      `payroll for ${depotId} ${periodMonth}`,
    );
    if (!body) return null;
    return typeof body.payrollMtdNet === 'number' ? Math.round(body.payrollMtdNet) : 0;
  }

  private async get<T>(baseUrl: string, path: string, what: string): Promise<T | null> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey || !baseUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotCostsHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { accept: 'application/json', 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`responded ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (error) {
      this.logger.warn(`Monthly ${what} unavailable: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
