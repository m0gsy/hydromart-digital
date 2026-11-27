import { Injectable, Logger } from '@nestjs/common';

import { InstantRange } from '../../application/ports/ai-money-sources.port';
import { AiVisitSourcesPort, VisitSummaryRow } from '../../application/ports/ai-visit-sources.port';
import { DashboardConfigService } from '../../config/dashboard-config.service';

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * AI-21: reads the per-depot visit counts from depot-service with the internal key. Only the six known
 * fields are copied out (anything else the reply carries is dropped). A failure, an unwired service, a row
 * for a depot nobody asked about, a missing or repeated depot, or a field of the wrong shape is null.
 */
@Injectable()
export class AiVisitSourcesHttpAdapter implements AiVisitSourcesPort {
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(AiVisitSourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  async summary(depotIds: readonly string[], range: InstantRange): Promise<VisitSummaryRow[] | null> {
    const url = `${this.config.depotServiceUrl}/api/v1/visits/internal/ai-summary?${new URLSearchParams({ depotIds: depotIds.join(','), ...range })}`;
    const where = url.split('?')[0];
    let body: { items?: unknown } | null;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': this.config.internalServiceKey, accept: 'application/json' },
        signal: AbortSignal.timeout(AiVisitSourcesHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`${where} answered ${res.status}`);
        return null;
      }
      body = (await res.json()) as { items?: unknown } | null;
    } catch (error) {
      this.logger.warn(`${where} unreachable: ${(error as Error).message}`);
      return null;
    }
    const items = body?.items;
    if (!Array.isArray(items) || items.length !== depotIds.length) return null;
    const asked = new Set(depotIds);
    const seen = new Set<string>();
    const out: VisitSummaryRow[] = [];
    for (const r of items as Record<string, unknown>[]) {
      if (!r || typeof r !== 'object' || typeof r.depotId !== 'string' || !asked.has(r.depotId) || seen.has(r.depotId)) return null;
      const lastOk = r.lastCompletedOn === null || (typeof r.lastCompletedOn === 'string' && DAY.test(r.lastCompletedOn));
      if (!lastOk || !isCount(r.completed) || !isCount(r.findings) || !isCount(r.followUpsOpen) || !isCount(r.followUpsOverdue)) return null;
      seen.add(r.depotId);
      out.push({
        depotId: r.depotId,
        completed: r.completed,
        findings: r.findings,
        lastCompletedOn: r.lastCompletedOn as string | null,
        followUpsOpen: r.followUpsOpen,
        followUpsOverdue: r.followUpsOverdue,
      });
    }
    return out;
  }
}
