import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import { OwnedDepotsPort } from '../../application/ports/owned-depots.port';

/** Reads depot-service through its internal-key route, the same door the other depot lookups use. */
@Injectable()
export class OwnedDepotsHttpAdapter implements OwnedDepotsPort {
  constructor(private readonly config: HrConfigService) {}

  async depotIdsOf(ownerId: string): Promise<string[]> {
    const { url, internalKey } = this.config.depotService;
    if (!url || !internalKey) {
      throw new ServiceUnavailableException('DEPOT_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
    }
    let res: Response;
    try {
      res = await fetch(
        `${url.replace(/\/$/, '')}/api/v1/depots/internal/owned/${encodeURIComponent(ownerId)}`,
        { headers: { 'x-internal-key': internalKey }, signal: AbortSignal.timeout(5000) },
      );
    } catch (err) {
      throw new ServiceUnavailableException(
        `depot-service tidak terjangkau: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `depot-service tidak bisa menyebut depot milik owner (${res.status})`,
      );
    }
    const body = (await res.json()) as { depotIds?: unknown };
    if (!Array.isArray(body.depotIds)) {
      throw new ServiceUnavailableException('depot-service menjawab dengan bentuk yang tidak dikenal');
    }
    return body.depotIds.filter((id): id is string => typeof id === 'string');
  }
}
