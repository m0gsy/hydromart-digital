import { Injectable, Logger } from '@nestjs/common';

import { NotificationPort } from '../../application/ports/notification.port';
import { HrConfigService } from '../../config/hr-config.service';

/**
 * Sends an HR notification through crm-service's system-to-system endpoint, authenticated
 * by the shared INTERNAL_SERVICE_KEY (HR triggers have no user token to forward — a leave
 * approval fires from the approver's request, not the recipient's).
 *
 * Fails OPEN: a missing URL or key disables it, and any error (crm down, non-2xx, timeout)
 * logs and returns. A leave approval must not fail because a WhatsApp message did.
 */
@Injectable()
export class NotificationHttpAdapter implements NotificationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(NotificationHttpAdapter.name);

  constructor(private readonly config: HrConfigService) {}

  async notify(
    event: string,
    phone: string,
    vars: Record<string, string>,
    subjectId: string,
  ): Promise<void> {
    const { url, internalKey } = this.config.crmService;
    if (!url || !internalKey) {
      this.logger.warn(`CRM_SERVICE_URL/INTERNAL_SERVICE_KEY unset; skipped ${event}`);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NotificationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${url}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalKey },
        // crm names the recipient field `customerId`; for HR it carries the employee's
        // auth account id, which is the same auth subject crm resolves against.
        body: JSON.stringify({ event, phone, customerId: subjectId, vars }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`crm-service responded ${res.status}`);
    } catch (error) {
      this.logger.warn(`${event} notification skipped: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
