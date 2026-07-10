import { Injectable, Logger } from '@nestjs/common';

import { SegmentUnavailableError } from '../../domain/errors';
import {
  CustomerDirectoryPort,
  DirectoryRecipient,
  SegmentFilter,
} from '../../application/ports/customer-directory.port';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * Resolves a broadcast audience from customer-service GET /profile/directory (FR-087),
 * forwarding the requesting staff member's bearer token (the endpoint is role-guarded).
 * Fails CLOSED: a missing URL, missing token, non-2xx, or network error throws
 * SegmentUnavailableError so marketing never sends a campaign to a silently-empty audience.
 */
@Injectable()
export class CustomerDirectoryHttpAdapter implements CustomerDirectoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CustomerDirectoryHttpAdapter.name);

  constructor(private readonly config: CrmConfigService) {}

  async resolveSegment(
    filter: SegmentFilter,
    authorization: string,
  ): Promise<DirectoryRecipient[]> {
    const base = this.config.customerServiceUrl;
    if (!base) throw new SegmentUnavailableError('CUSTOMER_SERVICE_URL not configured');
    if (!authorization) throw new SegmentUnavailableError('missing caller token');

    const params = new URLSearchParams();
    if (filter.tier) params.set('tier', filter.tier);
    if (filter.city) params.set('city', filter.city);
    const qs = params.toString();
    const url = `${base}/api/v1/profile/directory${qs ? `?${qs}` : ''}`;

    try {
      const res = await fetch(url, {
        headers: { authorization },
        signal: AbortSignal.timeout(CustomerDirectoryHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`directory lookup failed: ${res.status}`);
        throw new SegmentUnavailableError(`customer-service responded ${res.status}`);
      }
      return (await res.json()) as DirectoryRecipient[];
    } catch (error) {
      if (error instanceof SegmentUnavailableError) throw error;
      throw new SegmentUnavailableError((error as Error).message);
    }
  }
}
