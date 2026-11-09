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
  /** Matches customer-service's DIRECTORY_PAGE_MAX: a page this long may have a successor. */
  private static readonly PAGE_SIZE = 5000;
  /** A ceiling on the loop, not a feature: 200 pages is a million customers. */
  private static readonly MAX_PAGES = 200;
  private readonly logger = new Logger(CustomerDirectoryHttpAdapter.name);

  constructor(private readonly config: CrmConfigService) {}

  async resolveSegment(
    filter: SegmentFilter,
    authorization: string,
  ): Promise<DirectoryRecipient[]> {
    if (!authorization) throw new SegmentUnavailableError('missing caller token');
    return this.fetchDirectory('profile/directory', filter, { authorization });
  }

  async resolveSegmentAsService(filter: SegmentFilter): Promise<DirectoryRecipient[]> {
    const key = this.config.internalServiceKey;
    if (!key) throw new SegmentUnavailableError('INTERNAL_SERVICE_KEY not configured');
    return this.fetchDirectory('profile/internal/directory', filter, { 'x-internal-key': key });
  }

  /**
   * One request shape for both callers. The route and the credential differ; the query, the
   * timeout and every fail-closed branch must not — a directory that answered differently to
   * a person and to a service would put two audiences behind one screen again.
   */
  private async fetchDirectory(
    path: string,
    filter: SegmentFilter,
    headers: Record<string, string>,
  ): Promise<DirectoryRecipient[]> {
    const base = this.config.customerServiceUrl;
    if (!base) throw new SegmentUnavailableError('CUSTOMER_SERVICE_URL not configured');

    const out: DirectoryRecipient[] = [];
    let after: string | undefined;
    try {
      // CUS-06: the directory is paged. A full page may be followed by more, so resume after its
      // last customerId; stop on a short page, or when the cursor did not move (a server that
      // ignores it would otherwise be asked for the same page forever).
      for (let pages = 0; pages < CustomerDirectoryHttpAdapter.MAX_PAGES; pages += 1) {
        const params = new URLSearchParams();
        if (filter.tier) params.set('tier', filter.tier);
        if (filter.city) params.set('city', filter.city);
        if (after) params.set('after', after);
        const qs = params.toString();
        const res = await fetch(`${base}/api/v1/${path}${qs ? `?${qs}` : ''}`, {
          headers,
          signal: AbortSignal.timeout(CustomerDirectoryHttpAdapter.TIMEOUT_MS),
        });
        if (!res.ok) {
          this.logger.warn(`directory lookup failed: ${res.status}`);
          throw new SegmentUnavailableError(`customer-service responded ${res.status}`);
        }
        const page = (await res.json()) as DirectoryRecipient[];
        const last = page[page.length - 1]?.customerId;
        if (after && last === after) break;
        out.push(...page);
        if (page.length < CustomerDirectoryHttpAdapter.PAGE_SIZE || !last) break;
        after = last;
      }
      return out;
    } catch (error) {
      if (error instanceof SegmentUnavailableError) throw error;
      throw new SegmentUnavailableError((error as Error).message);
    }
  }
}
