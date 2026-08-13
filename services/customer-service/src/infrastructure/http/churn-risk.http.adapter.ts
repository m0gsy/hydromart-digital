import { Injectable, Logger } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import { ChurnBand, ChurnRiskPort } from '../../application/ports/churn-risk.port';

const BANDS: ReadonlySet<string> = new Set(['LOW', 'MEDIUM', 'HIGH']);

/**
 * One customer's churn band from forecast-service, over the shared internal key.
 *
 * Null on every failure AND on an unrecognised band. Defaulting to 'LOW' would be the
 * worst possible fallback here: low risk is the answer a manager acts on by doing nothing,
 * so an outage would quietly retire the follow-up queue.
 */
@Injectable()
export class ChurnRiskHttpAdapter implements ChurnRiskPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ChurnRiskHttpAdapter.name);

  constructor(private readonly config: CustomerConfigService) {}

  async bandFor(customerId: string): Promise<ChurnBand | null> {
    const base = this.config.forecastServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return null;
    const url = `${base}/api/v1/forecasts/internal/churn-band?customerId=${encodeURIComponent(customerId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ChurnRiskHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'x-internal-key': key },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`forecast-service responded ${res.status}`);
      const body = (await res.json()) as { riskBand?: string | null };
      // A 200 with a null band means "never ordered" — no recency, so no risk to report.
      return typeof body.riskBand === 'string' && BANDS.has(body.riskBand)
        ? (body.riskBand as ChurnBand)
        : null;
    } catch (error) {
      this.logger.warn(`Churn band unavailable for ${customerId}: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
