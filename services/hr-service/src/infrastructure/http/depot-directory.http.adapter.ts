import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import { DepotDirectoryPort } from '../../application/ports/depot-directory.port';

/** Reads depot-service through its internal-key route (same door as the assistant lookup). */
@Injectable()
export class DepotDirectoryHttpAdapter implements DepotDirectoryPort {
  constructor(private readonly config: HrConfigService) {}

  async isActive(depotId: string): Promise<boolean> {
    return (await this.describe(depotId)).active;
  }

  async names(depotIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    await Promise.all(
      [...new Set(depotIds)].map(async (id) => {
        try {
          const { name } = await this.describe(id);
          if (name) out.set(id, name);
        } catch {
          /* unnamed: the caller falls back to a short id */
        }
      }),
    );
    return out;
  }

  private async describe(depotId: string): Promise<{ active: boolean; name?: string }> {
    const { url, internalKey } = this.config.depotService;
    if (!url || !internalKey) {
      throw new ServiceUnavailableException('DEPOT_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
    }
    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/$/, '')}/api/v1/depots/internal/${depotId}/active`, {
        headers: { 'x-internal-key': internalKey },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `depot-service tidak terjangkau: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    if (res.status === 404) throw new NotFoundException('Depot tujuan tidak ditemukan');
    if (!res.ok) {
      throw new ServiceUnavailableException(`depot-service tidak bisa menyebut status depot (${res.status})`);
    }
    const body = (await res.json()) as { active?: boolean; name?: string };
    return { active: body.active === true, name: body.name };
  }
}
