import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import { DepotDirectoryPort } from '../../application/ports/depot-directory.port';

/** How long a depot's master coordinates are trusted before depot-service is asked again. */
const LOCATION_TTL_MS = 10 * 60_000;

/** Reads depot-service through its internal-key route (same door as the assistant lookup). */
@Injectable()
export class DepotDirectoryHttpAdapter implements DepotDirectoryPort {
  private readonly logger = new Logger(DepotDirectoryHttpAdapter.name);
  // ponytail: per-process map, never evicted: one entry per depot (tens), and a moved depot is
  // seen within the TTL. Each replica asks on its own; share it (Redis) only if that ever costs.
  private readonly locations = new Map<string, { at: number; value: { lat: number; lng: number } | null }>();

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

  /**
   * An answer is kept for the TTL, an answer without coordinates too (a depot-service from
   * before it sent them). A failure is not kept: the next punch asks again.
   */
  async location(depotId: string): Promise<{ lat: number; lng: number } | null> {
    const hit = this.locations.get(depotId);
    if (hit && Date.now() - hit.at < LOCATION_TTL_MS) return hit.value;
    try {
      const { lat, lng } = await this.describe(depotId);
      const value = lat !== undefined && lng !== undefined ? { lat, lng } : null;
      this.locations.set(depotId, { at: Date.now(), value });
      return value;
    } catch (err) {
      this.logger.warn(`Location of depot ${depotId} unknown: ${(err as Error).message}`);
      return null;
    }
  }

  private async describe(
    depotId: string,
  ): Promise<{ active: boolean; name?: string; lat?: number; lng?: number }> {
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
    const body = (await res.json()) as { active?: boolean; name?: string; lat?: unknown; lng?: unknown };
    const coord = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    return { active: body.active === true, name: body.name, lat: coord(body.lat), lng: coord(body.lng) };
  }
}
