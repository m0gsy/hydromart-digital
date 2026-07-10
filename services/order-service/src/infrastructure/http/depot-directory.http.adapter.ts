import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import {
  DepotDirectoryPort,
  DepotLocation,
} from '../../application/ports/depot-directory.port';

interface DepotResponse {
  id: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
}
interface DepotPage {
  items: DepotResponse[];
}

/**
 * Lists active depots from the depot-service public browse endpoint. Depot
 * routing is advisory (only stamps a reporting dimension on the order), so any
 * failure logs and returns [] — checkout must never fail because routing did.
 */
@Injectable()
export class DepotDirectoryHttpAdapter implements DepotDirectoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private static readonly PAGE_LIMIT = 100;
  private readonly logger = new Logger(DepotDirectoryHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async listActiveDepots(): Promise<DepotLocation[]> {
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
      }));
    } catch (error) {
      this.logger.warn(`Depot routing unavailable, order left unrouted: ${(error as Error).message}`);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
