import { Injectable, Logger } from '@nestjs/common';

import { NotificationPreferencePort } from '../../application/ports/notification-preference.port';
import { MessageLocale } from '../../domain/notification-event';
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
    // Only an explicit `false` mutes. A malformed body is an outage, not a decision.
    return (await this.read(customerId, 'push')).push !== false;
  }

  /**
   * K5.3. The same row the push toggle lives on, so this is the same request — no second
   * endpoint and no second copy of the customer's language. Falls back to Indonesian on an
   * outage, a missing column, or any value that is not a language crm holds templates for.
   */
  async localeFor(customerId: string): Promise<MessageLocale> {
    const locale = (await this.read(customerId, 'locale')).locale;
    return locale === 'en' || locale === 'id' ? locale : 'id';
  }

  async marketingAllowed(customerId: string): Promise<boolean> {
    const body = await this.read(customerId, 'marketing');
    const categories = (body.categories ?? {}) as Record<string, unknown>;
    // Absent key = never asked = still sendable. See the port for why that is the position.
    return categories.marketing !== false;
  }

  private async read(
    customerId: string,
    what: string,
  ): Promise<{ push?: unknown; categories?: unknown; locale?: unknown }> {
    const base = this.config.customerServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      this.logger.warn(`${what} preference not checked: customer-service URL or internal key missing`);
      return {};
    }

    const url = `${base}/api/v1/profile/internal/notifications?customerId=${encodeURIComponent(customerId)}`;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(NotificationPreferenceHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`${what} preference lookup responded ${res.status}; assuming allowed`);
        return {};
      }
      return (await res.json()) as { push?: unknown; categories?: unknown; locale?: unknown };
    } catch (error) {
      this.logger.warn(`${what} preference lookup failed: ${(error as Error).message}; assuming allowed`);
      return {};
    }
  }
}
