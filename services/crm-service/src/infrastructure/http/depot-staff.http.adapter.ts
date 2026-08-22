import { Injectable, Logger } from '@nestjs/common';

import { DepotStaffPort } from '../../application/ports/depot-staff.port';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * Reads a depot's active staff account ids from auth-service
 * `GET /auth/internal/staff/depot/:depotId`.
 *
 * Internal-key auth rather than a caller's bearer, because there is no caller: an ops alert
 * is raised by a cron, a stock write, or a courier's incident report.
 *
 * FAILS SOFT, and every empty answer says why in the log. The ops feed row is already
 * written by the time this runs, so an outage here costs a push and never the alert itself
 * — but it must not fail soft *silently*, or a misconfigured URL looks exactly like a depot
 * with nobody rostered.
 */
@Injectable()
export class DepotStaffHttpAdapter implements DepotStaffPort {
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(DepotStaffHttpAdapter.name);

  constructor(private readonly config: CrmConfigService) {}

  async staffIdsForDepot(depotId: string): Promise<string[]> {
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      this.logger.warn('depot staff not resolved: auth-service URL or internal key missing');
      return [];
    }
    const url = `${base}/api/v1/auth/internal/staff/depot/${encodeURIComponent(depotId)}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(DepotStaffHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`depot staff lookup responded ${res.status}; nobody will be pushed`);
        return [];
      }
      const body = (await res.json()) as { ids?: unknown };
      return Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string') : [];
    } catch (error) {
      this.logger.warn(`depot staff lookup failed: ${(error as Error).message}; nobody will be pushed`);
      return [];
    }
  }
}
