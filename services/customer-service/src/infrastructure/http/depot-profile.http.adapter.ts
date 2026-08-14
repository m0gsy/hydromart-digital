import { Injectable, Logger } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import { DepotGeo, DepotProfilePort } from '../../application/ports/depot-profile.port';

/**
 * Reads what depot-service knows about a depot itself: where it is, and who subscribes to it.
 *
 * Shaped like `DepotLedgerHttpAdapter` next to it — same timeout, same internal key, no
 * retry — and null on every failure for the same reason: on this screen a zero is a claim.
 *
 * The geo read goes to the PUBLIC depot projection, which already carries lat/lng and the
 * service radius. No internal key is needed for it, and inventing an internal twin of a
 * route that already answers this would be a second thing to keep in step.
 */
@Injectable()
export class DepotProfileHttpAdapter implements DepotProfilePort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(DepotProfileHttpAdapter.name);

  constructor(private readonly config: CustomerConfigService) {}

  async geo(depotId: string): Promise<DepotGeo | null> {
    const base = this.config.depotServiceUrl;
    if (!base) return null;
    const body = await this.read<Partial<DepotGeo>>(
      `${base}/api/v1/depots/${encodeURIComponent(depotId)}`,
      {},
      `depot location for ${depotId}`,
    );
    if (!body) return null;
    const { lat, lng, serviceRadiusKm } = body;
    // A depot with no coordinates cannot judge an address; saying so is better than
    // answering "0 km away", which would put every address inside every radius.
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng, serviceRadiusKm: typeof serviceRadiusKm === 'number' ? serviceRadiusKm : 0 };
  }

  async subscriberIds(depotId: string): Promise<string[] | null> {
    const base = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return null;
    const url = `${base}/api/v1/subscriptions/internal/customer-ids?depotId=${encodeURIComponent(depotId)}`;
    const body = await this.read<{ customerIds?: string[] }>(
      url,
      { 'x-internal-key': key },
      `depot subscribers for ${depotId}`,
    );
    if (!body) return null;
    return Array.isArray(body.customerIds) ? body.customerIds : [];
  }

  private async read<T>(
    url: string,
    headers: Record<string, string>,
    what: string,
  ): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotProfileHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', ...headers },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`depot-service responded ${res.status}`);
      return (await res.json()) as T;
    } catch (error) {
      this.logger.warn(`Depot profile unavailable (${what}): ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
