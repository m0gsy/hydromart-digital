import { Injectable, Logger } from '@nestjs/common';

import { SopLookupPort } from '../../application/ports/sop-lookup.port';
import { SopInForce } from '../../domain/visit-template';
import { DepotConfigService } from '../../config/depot-config.service';

/**
 * Asks hr-service which version of each SOP is in force at a depot today
 * (`GET /api/v1/sops/internal/in-force?depotId=&ids=`, internal-key auth: nobody is "calling",
 * a checklist is being read).
 *
 * Fails SOFT: a blank URL or key, a timeout, a non-2xx or a malformed body all answer `null`
 * and say why in the log, so a misconfigured URL is visible but a checklist never disappears
 * because hr is down.
 */
@Injectable()
export class SopLookupHttpAdapter implements SopLookupPort {
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(SopLookupHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async inForce(depotId: string, sopIds: readonly string[]): Promise<SopInForce[] | null> {
    const base = this.config.hrServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      this.logger.warn('SOP lookup skipped: hr-service URL or internal key missing');
      return null;
    }
    if (sopIds.length === 0) return [];
    try {
      const qs = new URLSearchParams({ depotId, ids: sopIds.join(',') });
      const res = await fetch(`${base}/api/v1/sops/internal/in-force?${qs.toString()}`, {
        headers: { accept: 'application/json', 'x-internal-key': key },
        signal: AbortSignal.timeout(SopLookupHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`SOP lookup responded ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { items?: unknown };
      if (!Array.isArray(body?.items)) {
        this.logger.warn('SOP lookup answered an unexpected body');
        return null;
      }
      const out: SopInForce[] = [];
      for (const row of body.items) {
        const r = row as Partial<SopInForce>;
        if (
          typeof r?.sopId === 'string' &&
          typeof r.versionId === 'string' &&
          typeof r.versionNo === 'number' &&
          typeof r.title === 'string' &&
          typeof r.effectiveFrom === 'string'
        ) {
          out.push({
            sopId: r.sopId,
            versionId: r.versionId,
            versionNo: r.versionNo,
            title: r.title,
            effectiveFrom: r.effectiveFrom,
          });
        }
      }
      return out;
    } catch (error) {
      this.logger.warn(`SOP lookup failed: ${(error as Error).message}`);
      return null;
    }
  }
}
