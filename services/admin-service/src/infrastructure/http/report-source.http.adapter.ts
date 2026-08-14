import { Injectable, Logger } from '@nestjs/common';

import { ReportDataset } from '../../domain/report-dataset';
import { ReportRow, ReportSourcePort } from '../../application/ports/report-source.port';
import { AdminConfigService } from '../../config/admin-config.service';

/** Where each dataset's rows live. Both routes answer the same label/orders/revenue shape. */
const SOURCE: Record<ReportDataset, { service: 'order' | 'payment'; path: string }> = {
  [ReportDataset.REVENUE_BY_DEPOT]: {
    service: 'order',
    path: 'reports/internal/export-rows?dataset=REVENUE_BY_DEPOT',
  },
  [ReportDataset.REVENUE_BY_PRODUCT]: {
    service: 'order',
    path: 'reports/internal/export-rows?dataset=REVENUE_BY_PRODUCT',
  },
  [ReportDataset.REVENUE_BY_METHOD]: {
    service: 'payment',
    path: 'payments/internal/export-rows?',
  },
};

/**
 * Reads a scheduled report's rows from the service that owns them, under the shared
 * internal key — the caller is cron, which holds no bearer.
 *
 * THROWS on every unhappy path. An empty spreadsheet is a real answer about a quiet month,
 * so a service that could not be reached must never be able to produce one; the sweep
 * records those runs as FAILED and `hq/exports` shows the failure instead.
 */
@Injectable()
export class ReportSourceHttpAdapter implements ReportSourcePort {
  private static readonly TIMEOUT_MS = 15_000;
  private readonly logger = new Logger(ReportSourceHttpAdapter.name);

  constructor(private readonly config: AdminConfigService) {}

  async rowsFor(dataset: ReportDataset, from: Date, to: Date): Promise<ReportRow[]> {
    const source = SOURCE[dataset];
    const base =
      source.service === 'order' ? this.config.orderServiceUrl : this.config.paymentServiceUrl;
    if (!base) throw new Error(`${source.service}-service URL not configured`);
    const key = this.config.internalServiceKey;
    if (!key) throw new Error('INTERNAL_SERVICE_KEY not configured');

    const window = `from=${from.toISOString()}&to=${to.toISOString()}`;
    const url = `${base}/api/v1/${source.path}${source.path.endsWith('?') ? '' : '&'}${window}`;

    const res = await fetch(url, {
      headers: { 'x-internal-key': key },
      signal: AbortSignal.timeout(ReportSourceHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.warn(`report rows for ${dataset} failed: ${res.status}`);
      throw new Error(`${source.service}-service responded ${res.status}`);
    }
    return ((await res.json()) as { rows: ReportRow[] }).rows;
  }
}
