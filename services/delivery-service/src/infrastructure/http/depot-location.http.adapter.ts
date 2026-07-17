import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { DepotLocation, DepotLocationPort } from '../../application/ports/depot-location.port';

/**
 * Reads a depot's coordinates for the check-in GPS gate. `GET /depots/:id` is
 * public on depot-service, so no token is forwarded. Throws on any non-2xx or
 * network failure: the caller (ShiftService) turns that into a DepotLookupError,
 * keeping check-in fail-closed.
 */
@Injectable()
export class DepotLocationHttpAdapter implements DepotLocationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(DepotLocationHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async find(depotId: string): Promise<DepotLocation | null> {
    const url = `${this.config.depotServiceUrl}/api/v1/depots/${depotId}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotLocationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
      const body = (await res.json()) as Partial<DepotLocation>;
      // A depot without coordinates cannot anchor a radius check — treat as unknown
      // rather than silently passing every check-in.
      if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
        return null;
      }
      return { id: depotId, name: body.name ?? '', lat: body.lat, lng: body.lng };
    } catch (error) {
      this.logger.error(`GET depot ${depotId} failed: ${(error as Error).message}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
