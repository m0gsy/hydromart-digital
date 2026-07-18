import { Injectable, Logger } from '@nestjs/common';

import { LoyaltyConfigService } from '../../config/loyalty-config.service';
import { CustomerDirectory } from '../../application/ports/customer-directory.port';

/**
 * Talks to customer-service to resolve a depot's customers. System-to-system call
 * authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key). Fails OPEN: any
 * error (unconfigured, timeout, non-2xx, bad body) returns [] so a depot summary
 * degrades to zeros rather than erroring.
 */
@Injectable()
export class CustomerDirectoryHttpAdapter implements CustomerDirectory {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CustomerDirectoryHttpAdapter.name);

  constructor(private readonly config: LoyaltyConfigService) {}

  async customerIdsForDepot(depotId: string): Promise<string[]> {
    const base = this.config.customerServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      this.logger.warn(`Depot customer lookup skipped for ${depotId}: directory not configured`);
      return [];
    }

    const url = `${base}/api/v1/customers/internal/by-depot?depotId=${encodeURIComponent(depotId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CustomerDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': key },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`customer-service responded ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as { customerIds?: string[] };
      return Array.isArray(body.customerIds) ? body.customerIds : [];
    } catch (error) {
      this.logger.warn(`Depot customer lookup failed for ${depotId}: ${(error as Error).message}`);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
