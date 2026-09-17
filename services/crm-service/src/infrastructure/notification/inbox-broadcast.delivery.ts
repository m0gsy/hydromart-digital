import { Inject, Injectable, Optional } from '@nestjs/common';

import { BroadcastDeliveryPort } from '../../application/ports/broadcast-delivery.port';
import { NotificationPreferencePort } from '../../application/ports/notification-preference.port';
import { NotificationService } from '../../application/services/notification.service';
import { CRM_TOKENS } from '../../application/tokens';
import { MarketingPreferenceUnavailableError, RecipientOptedOutError } from '../../domain/errors';
import { NotificationEvent } from '../../domain/notification-event';

/**
 * Campaign delivery over the notification path: an inbox row, plus best-effort push.
 *
 * Thin on purpose — `NotificationService.notify` already owns the row, the push fan-out and
 * the "push must never fail the notification" rule. All this adds is the BROADCAST event,
 * whose template is a passthrough because staff authored the whole message.
 *
 * F1b — and the marketing opt-out, as a BACKSTOP. The durable gate is the audience query in
 * customer-service: it has no network hop and no failure mode, and filtering there keeps the
 * campaign's recipient count honest. But `CampaignService.create` also accepts an EXPLICIT
 * recipient list — a pasted set of numbers that never touches the directory — and that list
 * is the door the audience query cannot cover. Every campaign message passes through here,
 * whichever door it came in by.
 *
 * The opt-out stops the INBOX ROW too, not only the push. A promotional message somebody
 * switched off should not be sitting in their feed waiting to be read.
 */
@Injectable()
export class InboxBroadcastDelivery implements BroadcastDeliveryPort {
  constructor(
    private readonly notifications: NotificationService,
    @Optional()
    @Inject(CRM_TOKENS.NotificationPreference)
    private readonly prefs?: NotificationPreferencePort,
  ) {}

  async deliver(phone: string, message: string, customerId: string): Promise<void> {
    if (!(await this.allowed(customerId))) throw new RecipientOptedOutError();
    await this.notifications.notify(NotificationEvent.BROADCAST, phone, { message }, customerId);
  }

  /**
   * CRM-2 — fails CLOSED. "The audience was already filtered" is not true of a pasted
   * recipient list, which is the only reason this backstop exists. No port wired, or a
   * preference that cannot be read, holds the message with a reason that is not "opted out".
   */
  private async allowed(customerId: string): Promise<boolean> {
    if (!this.prefs) throw new MarketingPreferenceUnavailableError();
    try {
      return await this.prefs.marketingAllowed(customerId);
    } catch {
      throw new MarketingPreferenceUnavailableError();
    }
  }
}
