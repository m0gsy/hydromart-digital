import { Injectable, Logger } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import {
  CustomerDepotDepositRow,
  DepotGallonLedgerEntry,
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
    const qs = `depotId=${encodeURIComponent(depotId)}`;
    return this.read<DepotGallonLedgerRow>(`by-customer?${qs}`, null);
  }

  async depositsForCustomer(customerId: string): Promise<CustomerDepotDepositRow[] | null> {
    const qs = `customerId=${encodeURIComponent(customerId)}`;
    return this.read<CustomerDepotDepositRow>(`for-customer?${qs}`, null);
  }

  async customerLedger(depotId: string, customerId: string): Promise<DepotGallonLedgerEntry[]> {
    const qs = `depotId=${encodeURIComponent(depotId)}&customerId=${encodeURIComponent(customerId)}`;
    return this.read<DepotGallonLedgerEntry>(`customer-ledger?${qs}`, []);
  }

  /**
   * Shared fetch for both reads. `onFailure` differs per caller on purpose — see the port:
   * the summary must say "not known", the history may say "nothing yet".
   */
  private async read<T>(path: string, onFailure: null): Promise<T[] | null>;
  private async read<T>(path: string, onFailure: T[]): Promise<T[]>;
  private async read<T>(path: string, onFailure: T[] | null): Promise<T[] | null> {
    const base = this.config.depotServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return onFailure;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DepotLedgerHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/api/v1/gallon-outstanding/internal/${path}`, {
        headers: { 'x-internal-key': key },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`depot-service responded ${res.status}`);
      const body = (await res.json()) as T[];
      return Array.isArray(body) ? body : onFailure;
    } catch (error) {
      this.logger.warn(`Depot gallon ledger unavailable: ${(error as Error).message}`);
      return onFailure;
    } finally {
      clearTimeout(timer);
    }
  }
}
