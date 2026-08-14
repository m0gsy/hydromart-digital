import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { CustomerNotificationPort } from '../../application/ports/customer-notification.port';

/** crm-service's SendNotificationDto accepts digits only, optionally `+`-prefixed. */
const CRM_PHONE_RE = /^\+?[0-9]{8,15}$/;

/**
 * Strip the separators a human types. A recipient phone can arrive as `0812-3456-7890`
 * from an address book, and crm answers 400 to that — which this adapter would swallow,
 * producing a notification that never arrives and never complains.
 */
function dial(phone: string): string {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return `${plus}${trimmed.replace(/\D/g, '')}`;
}

/**
 * Customer notifications from delivery-service, through crm's system-to-system endpoint
 * (shared INTERNAL_SERVICE_KEY, not a forwarded user token) — the same shape
 * order-service, depot-service, promo-service, hr-service and auth-service all use.
 *
 * Fails OPEN in every direction: no key, no crm URL, an unusable phone, a non-2xx, a
 * timeout — each logs its reason by name and returns. The delivery change that triggered
 * it is already committed.
 */
@Injectable()
export class CustomerNotificationHttpAdapter implements CustomerNotificationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CustomerNotificationHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async notify(
    event: string,
    phone: string,
    vars: Record<string, string>,
    customerId: string | null,
  ): Promise<void> {
    const { crmServiceUrl, internalServiceKey } = this.config;
    if (!crmServiceUrl || !internalServiceKey) {
      this.logger.warn(`No crm URL or internal service key; skipped ${event} notification`);
      return;
    }
    const dialled = dial(phone);
    if (!CRM_PHONE_RE.test(dialled)) {
      this.logger.warn(`${event} notification skipped: "${phone}" is not a usable phone number`);
      return;
    }
    const url = `${crmServiceUrl}/api/v1/notifications/internal`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      CustomerNotificationHttpAdapter.TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ event, phone: dialled, customerId, vars }),
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
