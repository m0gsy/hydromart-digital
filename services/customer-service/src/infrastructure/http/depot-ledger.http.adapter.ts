import { Injectable, Logger } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import {
  DepotGallonLedgerRow,
  DepotLedgerPort,
} from '../../application/ports/depot-ledger.port';

/**
 * Reads one depot's per-customer gallon ledger from depot-service, over the shared
 * internal key. Shaped exactly like `OrderCrmHttpAdapter` next to it — timeout, internal
 * key, no retry — with one deliberate difference: it returns `null` on failure, not `[]`.
 *
 * `[]` would mean "no customer owes this depot anything", and the screen would print
 * zeroes. `null` means "not known", and the screen says so.
 */
@Injectable()
export class DepotLedgerHttpAdapter implements DepotLedgerPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(DepotLedgerHttpAdapter.name);

  constructor(private readonly config: CustomerConfigService) {}

  async gallonsByCustomer(depotId: string): Promise<DepotGallonLedgerRow[] | null> {
    const base = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return null;
    const url = `${base}/api/v1/gallon-outstanding/internal/by-customer?depotId=${encodeURIComponent(depotId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotLedgerHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { 'x-internal-key': key }, signal: controller.signal });
      if (!res.ok) throw new Error(`depot-service responded ${res.status}`);
      const body = (await res.json()) as DepotGallonLedgerRow[];
      return Array.isArray(body) ? body : null;
    } catch (error) {
      this.logger.warn(`Depot gallon ledger unavailable: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
