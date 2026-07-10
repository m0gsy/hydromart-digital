import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { NotificationPort } from '../../application/ports/notification.port';

/**
 * Fires a customer WhatsApp notification via crm-service on order lifecycle changes.
 * Uses crm's system-to-system endpoint authenticated by the shared INTERNAL_SERVICE_KEY
 * (not a forwarded user token) — so notifications fire even for token-less triggers like
 * the payment→order confirm callback. Fails OPEN: a blank key disables it, and any error
 * (crm down, non-2xx) logs and returns, so a notification failure never blocks a transition.
 */
@Injectable()
export class NotificationHttpAdapter implements NotificationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(NotificationHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async notify(
    event: string,
    phone: string,
    vars: Record<string, string>,
    customerId: string,
    _authorization: string,
  ): Promise<void> {
    const internalKey = this.config.internalServiceKey;
    if (!internalKey) {
      this.logger.warn(`No internal service key; skipped ${event} notification`);
      return;
    }
    const url = `${this.config.crmServiceUrl}/api/v1/notifications/internal`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NotificationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ event, phone, customerId, vars }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`crm-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`${event} notification skipped: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
