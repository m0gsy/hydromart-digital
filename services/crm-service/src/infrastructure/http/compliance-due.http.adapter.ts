import { Injectable } from '@nestjs/common';

import { ComplianceDuePort, DueCompliance } from '../../application/ports/compliance-due.port';
import { CrmConfigService } from '../../config/crm-config.service';

const isStr = (v: unknown): v is string => typeof v === 'string';

/** depot-service `GET internal/compliance/due`, internal key. Throws on any failure. */
@Injectable()
export class ComplianceDueHttpAdapter implements ComplianceDuePort {
  private static readonly TIMEOUT_MS = 15_000;

  constructor(private readonly config: CrmConfigService) {}

  async dueItems(): Promise<DueCompliance[]> {
    const base = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new Error('depot-service URL or internal key missing');
    const res = await fetch(`${base}/api/v1/internal/compliance/due`, {
      headers: { 'x-internal-key': key },
      signal: AbortSignal.timeout(ComplianceDueHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`depot-service responded ${res.status}`);
    const items = ((await res.json()) as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new Error('depot-service answered something malformed');
    return items.map((r: Record<string, unknown>) => {
      if (
        !isStr(r.id) ||
        !isStr(r.depotId) ||
        !isStr(r.depotName) ||
        (r.kind !== 'PERMIT' && r.kind !== 'LAB_TEST') ||
        !isStr(r.name) ||
        !isStr(r.dueOn) ||
        typeof r.daysLeft !== 'number' ||
        !Number.isFinite(r.daysLeft) ||
        !isStr(r.cycleStart)
      ) {
        throw new Error('depot-service answered something malformed');
      }
      return r as unknown as DueCompliance;
    });
  }
}
