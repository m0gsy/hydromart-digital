import { Injectable, Logger } from '@nestjs/common';

import { CustomerNotificationPort } from '../../application/ports/customer-notification.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * Sends the registration welcome via crm-service's system-to-system notification
 * endpoint, authenticated by the shared INTERNAL_SERVICE_KEY (crm owns the message
 * copy + WhatsApp delivery). Fails OPEN: a blank CRM URL/key disables it, and any
 * error is swallowed — registration must never fail because a welcome couldn't send.
 */
@Injectable()
export class CustomerNotificationHttpAdapter implements CustomerNotificationPort {
  private readonly logger = new Logger(CustomerNotificationHttpAdapter.name);

  constructor(private readonly config: AuthConfigService) {}

  async sendWelcome(phone: string, name: string): Promise<void> {
    const { crmUrl, internalKey } = this.config.customerNotifications;
    if (!crmUrl || !internalKey) {
      return; // feature disabled in this environment
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${crmUrl}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({
          event: 'CUSTOMER_REGISTERED',
          phone,
          vars: { name },
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        this.logger.warn(`Welcome notification rejected (${response.status}) for ${phone}`);
      }
    } catch (error) {
      this.logger.warn(`Welcome notification failed for ${phone}: ${(error as Error).message}`);
    }
  }
}
