import { Injectable } from '@nestjs/common';

import { HeldDepotsPort } from '../../application/ports/held-depots.port';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * depot-service's PUBLIC browse: every active depot with its `qualityHold` flag. Deliberately the public
 * route and no internal key: the flag (the fact and the day, never why) is already on the anonymous
 * depot list that customers' checkout reads, so this adds no exposure and needs no secret. Throws on any failure.
 */
@Injectable()
export class HeldDepotsHttpAdapter implements HeldDepotsPort {
  private static readonly TIMEOUT_MS = 8_000;
  private static readonly PAGE_LIMIT = 100;
  private static readonly MAX_PAGES = 50;

  constructor(private readonly config: CrmConfigService) {}

  async heldDepotIds(): Promise<ReadonlySet<string>> {
    const held = new Set<string>();
    for (const [id, depot] of await this.depotsById()) if (depot.held) held.add(id);
    return held;
  }

  async depotsById(): Promise<ReadonlyMap<string, { name: string; held: boolean }>> {
    const base = this.config.depotServiceUrl;
    if (!base) throw new Error('depot-service URL missing');
    const depots = new Map<string, { name: string; held: boolean }>();
    for (let page = 1; page <= HeldDepotsHttpAdapter.MAX_PAGES; page += 1) {
      const res = await fetch(`${base}/api/v1/depots?limit=${HeldDepotsHttpAdapter.PAGE_LIMIT}&page=${page}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(HeldDepotsHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`depot-service responded ${res.status}`);
      const body = (await res.json()) as { items?: unknown; totalPages?: unknown };
      if (!Array.isArray(body.items)) throw new Error('depot-service answered something malformed');
      for (const d of body.items as Array<{ id?: unknown; name?: unknown; qualityHold?: { active?: unknown } | null }>) {
        if (typeof d.id !== 'string') throw new Error('depot-service answered something malformed');
        depots.set(d.id, { name: typeof d.name === 'string' ? d.name : '', held: d.qualityHold?.active === true });
      }
      if (typeof body.totalPages !== 'number' || page >= body.totalPages) break;
    }
    return depots;
  }
}
