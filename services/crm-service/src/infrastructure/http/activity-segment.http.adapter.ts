import { Injectable, Logger } from '@nestjs/common';

import { SegmentUnavailableError } from '../../domain/errors';
import {
  ActivityConditions,
  ActivitySegmentPort,
} from '../../application/ports/activity-segment.port';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * Resolves an activity segment from order-service GET /reports/internal/segment-customers.
 *
 * Internal-key auth, not the caller's bearer: the route is a mailing-list resolver, and the
 * console roles that compose a campaign are not the roles that may page through customers.
 *
 * Fails CLOSED on every unhappy path — missing URL, missing key, non-2xx, network error,
 * AND a `truncated` answer. That last one is the important one: a segment bigger than
 * order-service's cap comes back as a partial list, and a campaign built from it would
 * report "sent" after reaching some of the people the screen counted.
 */
@Injectable()
export class ActivitySegmentHttpAdapter implements ActivitySegmentPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ActivitySegmentHttpAdapter.name);

  constructor(private readonly config: CrmConfigService) {}

  async customersIn(conditions: ActivityConditions): Promise<string[]> {
    const base = this.config.orderServiceUrl;
    if (!base) throw new SegmentUnavailableError('ORDER_SERVICE_URL not configured');
    const key = this.config.internalServiceKey;
    if (!key) throw new SegmentUnavailableError('INTERNAL_SERVICE_KEY not configured');

    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(conditions)) {
      if (value != null) params.set(name, String(value));
    }
    const url = `${base}/api/v1/reports/internal/segment-customers?${params.toString()}`;

    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(ActivitySegmentHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`segment lookup failed: ${res.status}`);
        throw new SegmentUnavailableError(`order-service responded ${res.status}`);
      }
      const body = (await res.json()) as { customerIds: string[]; truncated: boolean };
      if (body.truncated) {
        throw new SegmentUnavailableError(
          'segment is larger than order-service will resolve in one call',
        );
      }
      return body.customerIds;
    } catch (error) {
      if (error instanceof SegmentUnavailableError) throw error;
      throw new SegmentUnavailableError((error as Error).message);
    }
  }
}
