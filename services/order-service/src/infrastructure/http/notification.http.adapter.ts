import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@hydromart/platform';

import { OrderConfigService } from '../../config/order-config.service';
import { NotificationPort } from '../../application/ports/notification.port';

/** What crm-service's SendNotificationDto accepts. Duplicated on purpose — see `dial()`. */
const CRM_PHONE_RE = /^\+?[0-9]{8,15}$/;

/**
 * Strip the separators a human types. crm rejects anything but digits (optionally
 * +-prefixed), and this adapter is fail-open — a 400 is logged and swallowed — so an
 * operator who typed `0812-3456-7890` anywhere upstream would produce a notification that
 * never arrives and never complains. Every caller routes through here, so normalising once
 * covers the customer numbers, the ops alert number and the depot's own number alike.
 */
function dial(phone: string): string {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return `${plus}${trimmed.replace(/\D/g, '')}`;
}

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
    customerId: string | null,
    _authorization: string,
    depotId: string | null = null,
  ): Promise<boolean> {
    const internalKey = this.config.internalServiceKey;
    if (!internalKey) {
      this.logger.warn(`No internal service key; skipped ${event} notification`);
      return false;
    }
    const dialled = dial(phone);
    // Still unusable after normalising (empty, free text, too short): say so by name. crm
    // would 400 and this adapter would swallow it, which is how a depot goes a week without
    // its report while every log line reads "skipped".
    if (!CRM_PHONE_RE.test(dialled)) {
      this.logger.warn(
        `${event} notification skipped: "${maskPhone(phone)}" is not a usable phone number`,
      );
      return false;
    }
    const url = `${this.config.crmServiceUrl}/api/v1/notifications/internal`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NotificationHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ event, phone: dialled, customerId, vars, depotId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`crm-service responded ${res.status}`);
      }
      return true;
    } catch (error) {
      this.logger.warn(`${event} notification skipped: ${(error as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
