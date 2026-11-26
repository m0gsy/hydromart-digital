import { Injectable } from '@nestjs/common';

import { LegalEntityAudiencePort } from '../../application/ports/legal-entity-audience.port';
import { CrmConfigService } from '../../config/crm-config.service';

/** depot-service `GET legal-entities/internal/:id`, internal key; a 404 is "not an entity", anything else throws. */
@Injectable()
export class LegalEntityAudienceHttpAdapter implements LegalEntityAudiencePort {
  constructor(private readonly config: CrmConfigService) {}

  async audienceOf(id: string): Promise<{ name: string; active: boolean; aiReadRoles: string[] } | null> {
    const base = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new Error('depot-service URL or internal key missing');
    const res = await fetch(`${base}/api/v1/legal-entities/internal/${encodeURIComponent(id)}`, {
      headers: { 'x-internal-key': key },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`depot-service responded ${res.status}`);
    const { name, active, aiReadRoles } = (await res.json()) as { name?: unknown; active?: unknown; aiReadRoles?: unknown };
    if (typeof name !== 'string' || !name.trim() || typeof active !== 'boolean' || !Array.isArray(aiReadRoles)) {
      throw new Error('depot-service answered an entity without a name, active flag or roles');
    }
    return { name: name.trim(), active, aiReadRoles: aiReadRoles.filter((r): r is string => typeof r === 'string') };
  }
}
