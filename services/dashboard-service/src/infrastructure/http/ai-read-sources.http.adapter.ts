import { Injectable, Logger } from '@nestjs/common';

import {
  AiGrants,
  AiReadSourcesPort,
  DepotEntitySpan,
} from '../../application/ports/ai-read-sources.port';
import { DashboardConfigService } from '../../config/dashboard-config.service';

/**
 * HD-6: asks depot-service, with the internal key, which legal entity each depot belonged to and
 * which entities a role may read. Any failure (down, refused, malformed) is null: the scope
 * resolver then refuses to answer rather than answer without the narrowing.
 */
@Injectable()
export class AiReadSourcesHttpAdapter implements AiReadSourcesPort {
  private static readonly TIMEOUT_MS = 5000;
  /** The most depots one call takes (depot-service's DTO refuses more, and the URL stays short). */
  private static readonly DEPOTS_PER_CALL = 100;
  private readonly logger = new Logger(AiReadSourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  private async get(path: string): Promise<unknown | null> {
    const url = `${this.config.depotServiceUrl}/api/v1/legal-entities/internal/${path}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': this.config.internalServiceKey, accept: 'application/json' },
        signal: AbortSignal.timeout(AiReadSourcesHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`depot-service answered ${res.status} for ${path.split('?')[0]}`);
        return null;
      }
      return await res.json();
    } catch (error) {
      this.logger.warn(`depot-service unreachable for ${path.split('?')[0]}: ${(error as Error).message}`);
      return null;
    }
  }

  async entityTimeline(
    depotIds: readonly string[],
    from: string,
    to: string,
  ): Promise<DepotEntitySpan[] | null> {
    const size = AiReadSourcesHttpAdapter.DEPOTS_PER_CALL;
    const chunks: string[][] = [];
    for (let i = 0; i < depotIds.length; i += size) chunks.push(depotIds.slice(i, i + size));
    const parts = await Promise.all(
      chunks.map((chunk) =>
        this.get(`depot-entities?${new URLSearchParams({ from, to, depotIds: chunk.join(',') })}`),
      ),
    );
    const spans: DepotEntitySpan[] = [];
    for (const part of parts) {
      const rows = (part as { spans?: unknown } | null)?.spans;
      if (!Array.isArray(rows) || !rows.every(isSpan)) return null;
      spans.push(...rows);
    }
    return spans;
  }

  async entityName(legalEntityId: string): Promise<string | null> {
    const body = (await this.get(encodeURIComponent(legalEntityId))) as { name?: unknown } | null;
    return typeof body?.name === 'string' ? body.name : null;
  }

  async aiGrants(roleKey: string): Promise<AiGrants | null> {
    const body = (await this.get(`ai-grants/${encodeURIComponent(roleKey)}`)) as Partial<AiGrants> | null;
    const ids = body?.legalEntityIds;
    if (typeof body?.all !== 'boolean' || !Array.isArray(ids) || !ids.every((i) => typeof i === 'string')) {
      return null;
    }
    return { all: body.all, legalEntityIds: ids };
  }
}

function isSpan(row: unknown): row is DepotEntitySpan {
  const r = row as Partial<DepotEntitySpan> | null;
  return (
    typeof r?.depotId === 'string' &&
    typeof r.from === 'string' &&
    (r.legalEntityId === null || typeof r.legalEntityId === 'string')
  );
}
