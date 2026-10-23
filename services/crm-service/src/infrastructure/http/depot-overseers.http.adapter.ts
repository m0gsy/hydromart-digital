import { Injectable } from '@nestjs/common';

import { DepotOverseersPort } from '../../application/ports/depot-overseers.port';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * Asks depot-service `GET /depots/internal/:id/overseers` for the assistant supervisor and
 * everyone above them. Internal-key auth: there is no caller, an alert is raised by a cron or
 * a stock write. Throws on a failure (see the port).
 */
@Injectable()
export class DepotOverseersHttpAdapter implements DepotOverseersPort {
  private static readonly TIMEOUT_MS = 3000;

  constructor(private readonly config: CrmConfigService) {}

  async overseersOfDepot(depotId: string): Promise<string[]> {
    const base = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return [];
    const res = await fetch(
      `${base}/api/v1/depots/internal/${encodeURIComponent(depotId)}/overseers`,
      {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(DepotOverseersHttpAdapter.TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`depot-service responded ${res.status}`);
    const body = (await res.json()) as { ids?: unknown };
    return Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string') : [];
  }
}
