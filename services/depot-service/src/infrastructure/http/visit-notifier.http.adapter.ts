import { Injectable, Logger } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import { VisitNotice, VisitNotifierPort } from '../../application/ports/visit-notifier.port';

/**
 * POSTs one visit notice to crm-service's internal route (x-internal-key). Fails OPEN: a blank crm
 * URL / key, a timeout or a non-2xx logs and answers false; the visit is never rolled back.
 */
@Injectable()
export class VisitNotifierHttpAdapter implements VisitNotifierPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(VisitNotifierHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async notify(notice: VisitNotice): Promise<boolean> {
    const { internalServiceKey, crmServiceUrl } = this.config;
    if (!crmServiceUrl || !internalServiceKey) {
      this.logger.debug(`Visit notice (${notice.kind}) skipped: crm not configured`);
      return false;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VisitNotifierHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${crmServiceUrl}/api/v1/notifications/internal/visit-notice`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify(notice),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`crm-service responded ${res.status}`);
      return true;
    } catch (error) {
      this.logger.warn(`Visit notice (${notice.kind}) for ${notice.depotName} not sent: ${(error as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
