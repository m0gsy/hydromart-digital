import { Injectable } from '@nestjs/common';

import { LegalEntityNamesPort } from '../../application/ports/legal-entity-names.port';
import { CrmConfigService } from '../../config/crm-config.service';

/** depot-service `GET legal-entities/internal/:id`, internal key; a 404 is "not an entity", anything else throws. */
@Injectable()
export class LegalEntityNamesHttpAdapter implements LegalEntityNamesPort {
  private static readonly TIMEOUT_MS = 3000;

  constructor(private readonly config: CrmConfigService) {}

  async namesOf(ids: readonly string[]): Promise<string[]> {
    const base = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new Error('depot-service URL or internal key missing');
    const names = await Promise.all(
      ids.map(async (id) => {
        const res = await fetch(
          `${base}/api/v1/legal-entities/internal/${encodeURIComponent(id)}`,
          {
            headers: { 'x-internal-key': key },
            signal: AbortSignal.timeout(LegalEntityNamesHttpAdapter.TIMEOUT_MS),
          },
        );
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`depot-service responded ${res.status}`);
        const { name } = (await res.json()) as { name?: unknown };
        return typeof name === 'string' && name.trim() ? name.trim() : null;
      }),
    );
    return names.filter((n): n is string => n !== null);
  }
}
