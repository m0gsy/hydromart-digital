import { Injectable, Logger } from '@nestjs/common';

import { ReferralConfigService } from '../../config/referral-config.service';
import { CustomerDirectoryPort } from '../../application/ports/customer-directory.port';

/**
 * Resolves a depot's customerIds from customer-service for depot-scoped referral aggregates.
 * System-to-system call authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key).
 * Fails OPEN: any error (customer-service down, non-2xx, no key/url) logs a warning and
 * returns [], so the aggregate degrades to zeros instead of erroring the staff read.
 * Mirrors LoyaltyRewardHttpAdapter (same config style, same fail-open contract).
 */
@Injectable()
export class CustomerDirectoryHttpAdapter implements CustomerDirectoryPort {
  private static readonly TIMEOUT_MS = 5000;
  /** A ceiling on the loop, not a feature: 200 pages of 5000 is a million customers. */
  private static readonly MAX_PAGES = 200;
  private readonly logger = new Logger(CustomerDirectoryHttpAdapter.name);

  constructor(private readonly config: ReferralConfigService) {}

  async customerIdsForDepot(depotId: string): Promise<string[]> {
    const { internalServiceKey, customerServiceUrl } = this.config;
    if (!internalServiceKey || !customerServiceUrl) {
      this.logger.warn(`No customer-service url/key; depot ${depotId} resolves to no customers`);
      return [];
    }
    const baseUrl = `${customerServiceUrl}/api/v1/customers/internal/by-depot?depotId=${encodeURIComponent(depotId)}`;
    try {
      // CUS-06: the id list is paged; follow nextCursor until it is null, or stops advancing.
      const ids: string[] = [];
      let after: string | undefined;
      for (let pages = 0; pages < CustomerDirectoryHttpAdapter.MAX_PAGES; pages += 1) {
        const res = await fetch(after ? `${baseUrl}&after=${encodeURIComponent(after)}` : baseUrl, {
          headers: { 'x-internal-key': internalServiceKey },
          signal: AbortSignal.timeout(CustomerDirectoryHttpAdapter.TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(`customer-service responded ${res.status}`);
        }
        const body = (await res.json()) as { customerIds?: unknown; nextCursor?: unknown };
        if (Array.isArray(body.customerIds)) {
          ids.push(...body.customerIds.filter((id): id is string => typeof id === 'string'));
        }
        const next = typeof body.nextCursor === 'string' ? body.nextCursor : null;
        if (!next || next === after) break;
        after = next;
      }
      return ids;
    } catch (error) {
      this.logger.warn(
        `Customer directory lookup failed for depot ${depotId}: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
