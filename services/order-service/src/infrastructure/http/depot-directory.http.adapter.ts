import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import {
  DepotContact,
  DepotDirectoryPort,
  DepotGallonReturns,
  DepotLocation,
  DepotOwnership,
} from '../../application/ports/depot-directory.port';
import { Holiday, OperatingHours } from '../../domain/opening-hours';

interface DepotResponse {
  id: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  deliveryFee: number;
  minOrderAmount?: number | null;
  name?: string;
  operatingHours?: unknown;
  holidays?: unknown;
}
interface DepotPage {
  items: DepotResponse[];
}

/**
 * Lists active depots from the depot-service public browse endpoint. On any
 * failure (unreachable, timeout, non-2xx) it logs and returns null so checkout
 * stays fail-open; a successful response returns the depots (possibly empty).
 */
@Injectable()
export class DepotDirectoryHttpAdapter implements DepotDirectoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private static readonly PAGE_LIMIT = 100;
  private readonly logger = new Logger(DepotDirectoryHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async listActiveDepots(): Promise<DepotLocation[] | null> {
    const url = `${this.config.depotServiceUrl}/api/v1/depots?limit=${DepotDirectoryHttpAdapter.PAGE_LIMIT}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
      const body = (await res.json()) as DepotPage;
      return body.items.map((d) => ({
        id: d.id,
        lat: d.lat,
        lng: d.lng,
        serviceRadiusKm: d.serviceRadiusKm,
        deliveryFee: d.deliveryFee,
        minOrderAmount: d.minOrderAmount ?? null,
        name: d.name ?? '',
        // The public projection already sends both; they are `unknown` there because the
        // column is a JSON blob. Anything that is not the expected shape reads as "not
        // configured", which `isOpenAt` treats as always open — never as silently closed.
        operatingHours:
          d.operatingHours && typeof d.operatingHours === 'object' && !Array.isArray(d.operatingHours)
            ? (d.operatingHours as OperatingHours)
            : {},
        holidays: Array.isArray(d.holidays) ? (d.holidays as Holiday[]) : [],
      }));
    } catch (error) {
      this.logger.warn(
        `Depot routing unavailable, order left unrouted: ${(error as Error).message}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async listContacts(): Promise<DepotContact[] | null> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) return null;
    const url = `${this.config.depotServiceUrl}/api/v1/depots/internal/contacts`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
      const body = (await res.json()) as { depots?: DepotContact[] };
      return Array.isArray(body.depots) ? body.depots : null;
    } catch (error) {
      this.logger.warn(`Depot contacts unavailable: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async gallonReturns(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<DepotGallonReturns | null> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) return null;
    const query = `depotId=${encodeURIComponent(depotId)}&from=${from.toISOString()}&to=${to.toISOString()}`;
    const url = `${this.config.depotServiceUrl}/api/v1/gallon-outstanding/internal/returns-range?${query}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
      const body = (await res.json()) as Partial<DepotGallonReturns>;
      return { gallons: body.gallons ?? 0, damaged: body.damaged ?? 0 };
    } catch (error) {
      // Null, not zero: "no empties came back today" is a real operational fact and must
      // not be indistinguishable from "depot-service did not answer".
      this.logger.warn(`Gallon returns unavailable for ${depotId}: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async findOwner(depotId: string): Promise<DepotOwnership | null> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) return null;
    const url = `${this.config.depotServiceUrl}/api/v1/depots/internal/${depotId}/owner`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
      const body = (await res.json()) as Partial<DepotOwnership>;
      return { ownerId: body.ownerId ?? null, ownershipType: body.ownershipType ?? 'HKP' };
    } catch (error) {
      this.logger.warn(`Depot owner lookup failed for ${depotId}: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
