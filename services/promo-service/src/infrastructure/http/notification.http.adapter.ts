import { Injectable, Logger } from '@nestjs/common';

import { NotificationPort } from '../../application/ports/notification.port';
import { PromoConfigService } from '../../config/promo-config.service';

/**
 * Fires a customer notification via crm's system-to-system endpoint (INTERNAL_SERVICE_KEY).
 * Mirrors order-service's adapter. Fails OPEN: a blank key or any error logs and returns,
 * so a notification hiccup never unwinds the voucher grant.
 */
@Injectable()
export class NotificationHttpAdapter implements NotificationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(NotificationHttpAdapter.name);

  constructor(private readonly config: PromoConfigService) {}

  async notify(
    event: string,
    phone: string,
    customerId: string,
    vars: Record<string, string>,
  ): Promise<void> {
    const internalKey = this.config.internalServiceKey;
    const base = this.config.crmServiceUrl;
    if (!internalKey || !base) {
      this.logger.warn(`crm not configured; skipped ${event} notification`);
      return;
    }
    try {
      const res = await fetch(`${base}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ event, phone, customerId, vars }),
        signal: AbortSignal.timeout(NotificationHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`crm-service responded ${res.status}`);
    } catch (error) {
      this.logger.warn(`${event} notification skipped: ${(error as Error).message}`);
    }
  }
}
