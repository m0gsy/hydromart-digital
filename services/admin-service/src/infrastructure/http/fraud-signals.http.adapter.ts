import { Injectable, Logger } from '@nestjs/common';

import { FraudSignalsPort, RepeatedRefundSignal } from '../../application/ports/fraud-signals.port';
import { AdminConfigService } from '../../config/admin-config.service';

/**
 * Reads fraud signals from the service that owns them, under the shared internal key — the
 * caller is a scheduled scan, which holds no bearer.
 *
 * Answers NULL on every unhappy path. An empty flag queue is a real answer about a quiet
 * week, so a service that could not be reached must never be able to produce one.
 */
@Injectable()
export class FraudSignalsHttpAdapter implements FraudSignalsPort {
  private static readonly TIMEOUT_MS = 15_000;
  private readonly logger = new Logger(FraudSignalsHttpAdapter.name);

  constructor(private readonly config: AdminConfigService) {}

  async repeatedRefunds(
    from: Date,
    to: Date,
    minRefunds: number,
  ): Promise<RepeatedRefundSignal[] | null> {
    const base = this.config.paymentServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      this.logger.warn('Fraud scan skipped: payment-service URL or internal key is not set');
      return null;
    }
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      minRefunds: String(minRefunds),
    });
    try {
      const res = await fetch(`${base}/api/v1/payments/internal/refund-counts?${query}`, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(FraudSignalsHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`payment-service responded ${res.status}`);
      const body = (await res.json()) as { customers?: RepeatedRefundSignal[] };
      // A 200 with no rows in it is an answer we cannot read, not a quiet week.
      return Array.isArray(body.customers) ? body.customers : null;
    } catch (error) {
      this.logger.warn(`Fraud scan could not read refunds: ${(error as Error).message}`);
      return null;
    }
  }
}
