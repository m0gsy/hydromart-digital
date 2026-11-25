import { Injectable } from '@nestjs/common';

import { DueMaintenance, MaintenanceDuePort } from '../../application/ports/maintenance-due.port';
import { CrmConfigService } from '../../config/crm-config.service';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** depot-service `GET internal/maintenance/due`, internal key. Throws on any failure. */
@Injectable()
export class MaintenanceDueHttpAdapter implements MaintenanceDuePort {
  private static readonly TIMEOUT_MS = 15_000;

  constructor(private readonly config: CrmConfigService) {}

  async dueItems(): Promise<DueMaintenance[]> {
    const base = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new Error('depot-service URL or internal key missing');
    const res = await fetch(`${base}/api/v1/internal/maintenance/due`, {
      headers: { 'x-internal-key': key },
      signal: AbortSignal.timeout(MaintenanceDueHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`depot-service responded ${res.status}`);
    const items = ((await res.json()) as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new Error('depot-service answered something malformed');
    return items.map((r: Record<string, unknown>) => {
      if (
        !isStr(r.id) ||
        !isStr(r.depotId) ||
        !isStr(r.depotName) ||
        !isStr(r.name) ||
        !isStr(r.category) ||
        (r.dueBy !== 'DAYS' && r.dueBy !== 'VOLUME') ||
        !isNum(r.daysSinceService) ||
        !isNumOrNull(r.m3SinceService) ||
        !isNumOrNull(r.intervalDays) ||
        !isNumOrNull(r.intervalM3) ||
        !isStr(r.cycleStart)
      ) {
        throw new Error('depot-service answered something malformed');
      }
      return r as unknown as DueMaintenance;
    });
  }
}
