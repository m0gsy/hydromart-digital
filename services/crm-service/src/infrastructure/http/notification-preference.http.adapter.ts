import { Injectable, Logger } from '@nestjs/common';

import { NotificationPreferencePort } from '../../application/ports/notification-preference.port';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * Reads one customer's push preference from customer-service
 * `GET /profile/internal/notifications`.
 *
 * Internal-key auth rather than the caller's bearer, because there usually is no caller:
 * `notify()` runs from an order-service webhook, a cron, or a courier's PoD, and none of
 * those hold the customer's token.
 *
 * FAILS OPEN, and every path that returns `true` says why in the log. An outage here must
 * not silence an order-status push — see the port for the reasoning. The one thing it must
 * not do is fail open *silently*, because then a permanently misconfigured URL looks
 * exactly like a customer who left push on.
 */
@Injectable()
export class NotificationPreferenceHttpAdapter implements NotificationPreferencePort {
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(NotificationPreferenceHttpAdapter.name);

  constructor(private readonly config: CrmConfigService) {}

  async pushAllowed(customerId: string): Promise<boolean> {
    const base = this.config.customerServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      this.logger.warn('push preference not checked: customer-service URL or internal key missing');
      return true;
    }

    const url = `${base}/api/v1/profile/internal/notifications?customerId=${encodeURIComponent(customerId)}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(NotificationPreferenceHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`push preference lookup responded ${res.status}; assuming allowed`);
        return true;
      }
      const body = (await res.json()) as { push?: unknown };
      // Only an explicit `false` mutes. A malformed body is an outage, not a decision.
      return body.push !== false;
    } catch (error) {
      this.logger.warn(`push preference lookup failed: ${(error as Error).message}; assuming allowed`);
      return true;
    }
  }
}
