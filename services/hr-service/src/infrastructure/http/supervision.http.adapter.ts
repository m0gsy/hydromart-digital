import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { httpSuperiorResolver } from '@hydromart/platform';

import { HrConfigService } from '../../config/hr-config.service';
import { SupervisionPort } from '../../application/ports/supervision.port';

/**
 * Reads the reporting line from depot-service, through the shared resolver in
 * @hydromart/platform (internal key, hard timeout) rather than another hand-rolled fetch.
 *
 * Swallows failures by design (see the port doc): the only caller is a notification, and
 * a leave request must not be rejected because depot-service blinked. The miss is logged,
 * so a persistently broken link is visible rather than silently unnotified.
 */
@Injectable()
export class SupervisionHttpAdapter implements SupervisionPort {
  private readonly logger = new Logger(SupervisionHttpAdapter.name);
  private readonly resolve = httpSuperiorResolver({
    depotServiceUrl: process.env.DEPOT_SERVICE_URL,
    internalKey: process.env.INTERNAL_SERVICE_KEY,
  });

  // Injected, not read at field-initialisation time like the two lines above. Those are
  // left alone deliberately — rewriting them is a behaviour change to a working path — but
  // anything NEW reads its URL through the config service, which is the only form
  // `check-endpoint-contracts` can resolve.
  constructor(private readonly config: HrConfigService) {}

  async superiorOf(authSubjectId: string): Promise<string | null> {
    try {
      return await this.resolve(authSubjectId);
    } catch (err) {
      this.logger.warn(
        `Atasan untuk ${authSubjectId} tidak bisa dibaca: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return null;
    }
  }

  /**
   * Who decides a kasbon raised at this depot.
   *
   * Throws where `superiorOf` swallows, and the difference is what is at stake: a missed
   * notification is a missed notification, but a failed lookup treated as "no assistant"
   * would hand the decision to anyone whose scope reaches the depot. 503 says "ask again",
   * which is the honest answer when the service that knows is not answering.
   */
  async assistantOfDepot(depotId: string): Promise<string | null> {
    const { url, internalKey } = this.config.depotService;
    if (!url || !internalKey) {
      throw new ServiceUnavailableException('DEPOT_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
    }
    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/$/, '')}/api/v1/depots/internal/${depotId}/assistant`, {
        headers: { 'x-internal-key': internalKey },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `depot-service tidak terjangkau: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `depot-service tidak bisa menyebut asisten supervisor depot (${res.status})`,
      );
    }
    const body = (await res.json()) as { assistantSupervisorId?: string | null };
    return body.assistantSupervisorId ?? null;
  }

  /**
   * Writes through the console's own route rather than a new internal one: the internal key
   * authenticates as the system principal, and that route is `hierarchyAdmin`
   * (SUPER_ADMIN), so it already accepts this caller — one writer, one set of rules,
   * including the cycle check.
   */
  async setSuperior(authSubjectId: string, superiorAuthSubjectId: string): Promise<void> {
    const url = process.env.DEPOT_SERVICE_URL;
    const internalKey = process.env.INTERNAL_SERVICE_KEY;
    if (!url || !internalKey) {
      throw new ServiceUnavailableException('DEPOT_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
    }
    let res: Response;
    try {
      res = await fetch(
        `${url.replace(/\/$/, '')}/api/v1/staff-hierarchy/${authSubjectId}/superior`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-internal-key': internalKey },
          body: JSON.stringify({ superiorId: superiorAuthSubjectId }),
        },
      );
    } catch (err) {
      throw new ServiceUnavailableException(
        `depot-service tidak terjangkau: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(`depot-service menolak tautan atasan (${res.status})`);
    }
  }
}
