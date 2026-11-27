import { Injectable, Logger } from '@nestjs/common';

import { AiProspectSourcesPort, ProspectAggregate, ProspectLevel, ProspectQuery } from '../../application/ports/ai-prospect-sources.port';
import { DashboardConfigService } from '../../config/dashboard-config.service';

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const GRID = /^-?\d+:-?\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BPS = /^\d{7,10}$/;
/** A category, status or outcome id: upper-case words, never free text. */
const ID = /^[A-Z][A-Z_]*$/;
/** The code each level's `key` must look like: anything else is a source we do not understand. */
const KEY: Record<ProspectLevel, RegExp> = { depot: UUID, kecamatan: BPS, kelurahan: BPS, grid: GRID };

/** A breakdown map: absent is fine (undefined), a map of ids to counts is fine, anything else is null. */
const counts = (v: unknown): Record<string, number> | undefined | null =>
  v === undefined ? undefined : isObj(v) && Object.entries(v).every(([k, n]) => ID.test(k) && isCount(n)) ? (v as Record<string, number>) : null;

/**
 * AREA-3: reads the grouped prospect counts with the internal key. Only counts, codes and region names
 * are copied out of the reply (a field it does not know is dropped, never passed on). Any failure, an
 * unwired service, or a shape it does not recognise is null.
 */
@Injectable()
export class AiProspectSourcesHttpAdapter implements AiProspectSourcesPort {
  private static readonly TIMEOUT_MS = 15000;
  private readonly logger = new Logger(AiProspectSourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  private async call(url: string, deadline: number, body: unknown): Promise<unknown | null> {
    const left = deadline - Date.now();
    if (left <= 0) {
      this.logger.warn(`${url} not called: the overall deadline has passed`);
      return null;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'x-internal-key': this.config.internalServiceKey, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(AiProspectSourcesHttpAdapter.TIMEOUT_MS, left)),
      });
      if (!res.ok) {
        this.logger.warn(`${url} answered ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (error) {
      this.logger.warn(`${url} unreachable: ${(error as Error).message}`);
      return null;
    }
  }

  async prospectAggregates(query: ProspectQuery, deadline: number): Promise<ProspectAggregate[] | null> {
    const base = this.config.customerServiceUrl;
    if (!base) return null;
    const b = await this.call(`${base}/api/v1/customers/internal/prospect-aggregates`, deadline, {
      ...query,
      depotIds: query.depotIds && [...query.depotIds],
    });
    if (!isObj(b) || !Array.isArray(b.cells)) return null;
    const out: ProspectAggregate[] = [];
    for (const r of b.cells as unknown[]) {
      if (!isObj(r) || !isCount(r.total)) return null;
      const keyOk = r.key === null || (typeof r.key === 'string' && KEY[query.level].test(r.key));
      const parentOk = r.parent === null || (typeof r.parent === 'string' && BPS.test(r.parent));
      const nameOk = r.name === null || typeof r.name === 'string';
      const byCategory = counts(r.byCategory);
      const byStatus = counts(r.byStatus);
      const byOutcome = counts(r.byOutcome);
      const numOk = [r.withPhone, r.dataAgeDaysMedian, r.prospectsVisited].every((n) => n === undefined || isCount(n));
      if (!keyOk || !parentOk || !nameOk || byCategory === null || byStatus === null || byOutcome === null || !numOk) return null;
      out.push({
        key: r.key as string | null,
        parent: r.parent as string | null,
        name: r.name as string | null,
        total: r.total,
        ...(byCategory ? { byCategory } : {}),
        ...(byStatus ? { byStatus } : {}),
        ...(byOutcome ? { byOutcome } : {}),
        ...(r.withPhone !== undefined ? { withPhone: r.withPhone as number } : {}),
        ...(r.dataAgeDaysMedian !== undefined ? { dataAgeDaysMedian: r.dataAgeDaysMedian as number } : {}),
        ...(r.prospectsVisited !== undefined ? { prospectsVisited: r.prospectsVisited as number } : {}),
      });
    }
    return out;
  }
}
