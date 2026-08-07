import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { httpSuperiorResolver } from '@hydromart/platform';

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
