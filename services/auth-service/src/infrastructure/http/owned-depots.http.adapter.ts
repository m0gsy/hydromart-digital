import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { OwnedDepotsPort } from '../../application/ports/owned-depots.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * depot-service's list of depots an owner holds a share in (`internal/owned/:ownerId`), over
 * the shared INTERNAL_SERVICE_KEY. Same shape as OpenOrdersHttpAdapter: every failure raises.
 */
@Injectable()
export class OwnedDepotsHttpAdapter implements OwnedDepotsPort {
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private readonly config: AuthConfigService) {}

  async countOwned(ownerId: string): Promise<number> {
    const base = this.config.serviceUrl('DEPOT_SERVICE_URL');
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      throw new ServiceUnavailableException(
        'DEPOT_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset; depot milik owner tidak bisa diperiksa.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OwnedDepotsHttpAdapter.TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(
        `${base}/api/v1/depots/internal/owned/${encodeURIComponent(ownerId)}`,
        { headers: { 'x-internal-key': key }, signal: controller.signal },
      );
    } catch (error) {
      throw new ServiceUnavailableException(
        `depot-service tidak terjangkau: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `depot-service menolak permintaan (${response.status})`,
      );
    }
    const body = (await response.json().catch(() => null)) as { depotIds?: unknown } | null;
    if (!Array.isArray(body?.depotIds)) {
      throw new ServiceUnavailableException(
        'depot-service mengembalikan hasil yang tidak dikenali.',
      );
    }
    return body.depotIds.length;
  }
}
