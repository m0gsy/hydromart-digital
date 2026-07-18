import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DepotOwnershipPort } from '../../application/ports/depot-ownership.port';
import { ForecastConfigService } from '../../config/forecast-config.service';

const TIMEOUT_MS = 5_000;

/**
 * Calls depot-service `GET /api/v1/depots/internal/owned/:ownerId` (INTERNAL_SERVICE_KEY auth)
 * to list a franchise owner's depot IDs. Fails CLOSED — misconfig, non-2xx, timeout or network
 * error throws ServiceUnavailable so the ownership guard denies rather than silently allowing.
 */
@Injectable()
export class DepotOwnershipHttpAdapter implements DepotOwnershipPort {
  constructor(private readonly config: ForecastConfigService) {}

  async ownedDepotIds(ownerId: string): Promise<string[]> {
    const baseUrl = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!baseUrl || !key) {
      throw new ServiceUnavailableException('Depot ownership lookup is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/api/v1/depots/internal/owned/${ownerId}`, {
        headers: { 'x-internal-key': key },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ServiceUnavailableException('Depot ownership lookup failed.');
      }
      const body = (await res.json()) as { depotIds?: unknown };
      return Array.isArray(body.depotIds) ? body.depotIds.filter((d): d is string => typeof d === 'string') : [];
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException('Depot ownership lookup failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
