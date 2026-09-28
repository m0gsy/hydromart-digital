import { Injectable, Logger } from '@nestjs/common';

import { CustomerNotificationPort } from '../../application/ports/customer-notification.port';
import { DepotConfigService } from '../../config/depot-config.service';

/**
 * Hands one customer message to crm-service's internal notification endpoint, authenticated
 * by the shared INTERNAL_SERVICE_KEY.
 *
 * Returns whether crm ACCEPTED it. That is the difference from `LowStockAlertHttpAdapter`
 * beside it: an ops alert is fire-and-forget, but the reminder sweep only writes "we asked"
 * when this says yes — otherwise an outage would silence a late customer for a week.
 * A blank crm URL or key (the dev default) answers `false` too: nothing was sent.
 */
@Injectable()
export class CustomerNotificationHttpAdapter implements CustomerNotificationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CustomerNotificationHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async send(
    event: 'GALLON_RETURN_REMINDER',
    phone: string,
    customerId: string,
    vars: Record<string, string>,
  ): Promise<boolean> {
    const base = this.config.crmServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return false;
    try {
      const res = await fetch(`${base}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ event, phone, customerId, vars }),
        signal: AbortSignal.timeout(CustomerNotificationHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`crm-service responded ${res.status}`);
      return true;
    } catch (error) {
      this.logger.warn(`${event} for ${customerId} not sent: ${(error as Error).message}`);
      return false;
    }
  }
}
