import { Injectable, Logger } from '@nestjs/common';
import { readServiceArea } from '@hydromart/platform';

import { OrderConfigService } from '../../config/order-config.service';
import {
  DepotContact,
  DepotDirectoryPort,
  DepotGallonReturns,
  DepotLocation,
  DepotOwnerShare,
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
  serviceArea?: unknown;
}
interface DepotPage {
  items: DepotResponse[];
  totalPages?: number;
}

/**
 * Lists active depots from the depot-service public browse endpoint. On any
 * failure (unreachable, timeout, non-2xx) it logs and returns null so checkout
 * stays fail-open; a successful response returns the depots (possibly empty).
 */
function isOwnerList(value: unknown): value is DepotOwnerShare[] {
  return (
    Array.isArray(value) &&
    value.every(
      (o) =>
        typeof o?.ownerId === 'string' &&
        typeof o?.sharePct === 'number' &&
        typeof o?.isPrimary === 'boolean',
    )
  );
}

@Injectable()
export class DepotDirectoryHttpAdapter implements DepotDirectoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private static readonly PAGE_LIMIT = 100;
  // Backstop against a depot-service that keeps claiming more pages: 100 × 50 = 5000 depots,
  // the same ceiling `DepotService.findNearby` scans.
  private static readonly MAX_PAGES = 50;
  private readonly logger = new Logger(DepotDirectoryHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  /**
   * Walks every page: the endpoint caps `limit` at 100, so reading only the first page made
   * the 101st depot invisible to routing — an address near it was told it is out of area.
   * One failing page fails the whole read (null) rather than returning a partial list that
   * would silently route to the wrong depot.
   */
  async listActiveDepots(): Promise<DepotLocation[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const items: DepotResponse[] = [];
      for (let page = 1; page <= DepotDirectoryHttpAdapter.MAX_PAGES; page += 1) {
        const url = `${this.config.depotServiceUrl}/api/v1/depots?limit=${DepotDirectoryHttpAdapter.PAGE_LIMIT}&page=${page}&includeArea=true`;
        const res = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`depot-service responded ${res.status}`);
        }
        const body = (await res.json()) as DepotPage;
        items.push(...body.items);
        if (typeof body.totalPages !== 'number' || page >= body.totalPages) break;
      }
      return items.map((d) => ({
        id: d.id,
        lat: d.lat,
        lng: d.lng,
        serviceRadiusKm: d.serviceRadiusKm,
        deliveryFee: d.deliveryFee,
        // An unreadable shape is "no drawn area" (radius routing), never an area that serves
        // nobody: one malformed row must not take a whole depot off the map.
        serviceArea: readServiceArea(d.serviceArea),
        minOrderAmount: d.minOrderAmount ?? null,
        name: d.name ?? '',
        // The public projection already sends both; they are `unknown` there because the
        // column is a JSON blob. Anything that is not the expected shape reads as "not
        // configured", which `isOpenAt` treats as always open — never as silently closed.
        operatingHours:
          d.operatingHours &&
          typeof d.operatingHours === 'object' &&
          !Array.isArray(d.operatingHours)
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

  async gallonReturns(depotId: string, from: Date, to: Date): Promise<DepotGallonReturns | null> {
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

  async findOwner(depotId: string, asOf?: Date): Promise<DepotOwnership | null> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) return null;
    const url = `${this.config.depotServiceUrl}/api/v1/depots/internal/${depotId}/owner${asOf ? `?asOf=${encodeURIComponent(asOf.toISOString())}` : ''}`;
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
      const body = (await res.json()) as {
        ownerId?: string | null;
        owners?: unknown;
        ownershipType?: unknown;
      };
      // A body without a recognisable ownership type is no answer. Defaulting it to HKP read as
      // "company depot, nobody to credit" and silenced the log for a franchise with no owner.
      if (body.ownershipType !== 'WARALABA' && body.ownershipType !== 'HKP') {
        throw new Error('depot-service sent no ownership type');
      }
      let owners: DepotOwnerShare[];
      if (body.owners === undefined) {
        // A depot-service that predates multi-owner depots: one owner, taking everything.
        owners = body.ownerId ? [{ ownerId: body.ownerId, sharePct: 100, isPrimary: true }] : [];
      } else if (isOwnerList(body.owners)) {
        owners = body.owners;
      } else {
        throw new Error('depot-service sent a malformed owners list');
      }
      const primary = owners.find((o) => o.isPrimary)?.ownerId ?? body.ownerId ?? null;
      return { ownerId: primary, owners, ownershipType: body.ownershipType };
    } catch (error) {
      this.logger.warn(`Depot owner lookup failed for ${depotId}: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
