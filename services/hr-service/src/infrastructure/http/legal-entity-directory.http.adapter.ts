import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import {
  LegalEntityDirectoryPort,
  LegalEntitySummary,
} from '../../application/ports/legal-entity-directory.port';

/** Reads depot-service through its internal-key route, the same door as the depot look-up. */
@Injectable()
export class LegalEntityDirectoryHttpAdapter implements LegalEntityDirectoryPort {
  constructor(private readonly config: HrConfigService) {}

  async find(id: string): Promise<LegalEntitySummary | null> {
    const { url, internalKey } = this.config.depotService;
    if (!url || !internalKey) {
      throw new ServiceUnavailableException('DEPOT_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
    }
    let res: Response;
    try {
      res = await fetch(
        `${url.replace(/\/$/, '')}/api/v1/legal-entities/internal/${encodeURIComponent(id)}`,
        { headers: { 'x-internal-key': internalKey }, signal: AbortSignal.timeout(5000) },
      );
    } catch (err) {
      throw new ServiceUnavailableException(
        `depot-service tidak terjangkau: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ServiceUnavailableException(`depot-service tidak bisa menyebut badan hukum (${res.status})`);
    }
    const body = (await res.json()) as LegalEntitySummary;
    // Only a literal `true` is on: a body that says nothing is not a company open for staff.
    return { id: body.id, name: body.name, kind: body.kind, active: body.active === true };
  }
}
