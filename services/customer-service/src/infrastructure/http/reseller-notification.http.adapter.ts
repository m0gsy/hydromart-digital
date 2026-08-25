import { Inject, Injectable, Logger } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import { IdentityPort } from '../../application/ports/identity.port';
import {
  ResellerNotificationPort,
  ResellerPriceNotice,
} from '../../application/ports/reseller-notification.port';
import { CUSTOMER_TOKENS } from '../../application/tokens';

/**
 * Sends the agen a RESELLER_PRICE_CHANGED through crm-service's internal notification
 * endpoint — the same pipe every other transactional message uses, so it lands in their
 * in-app inbox AND on their phone rather than needing a channel of its own.
 *
 * The phone lives on the account (auth-service), not on the reseller row, so it is looked
 * up rather than copied — a number copied here is a number that goes stale the first time
 * someone changes it.
 *
 * FAILS OPEN throughout: a blank crm URL / internal key (alerting off in dev), an agen
 * with no phone on file, or any crm error logs and returns false. A depot's decision about
 * its own pricing must not be blocked by a messaging outage.
 */
@Injectable()
export class ResellerNotificationHttpAdapter implements ResellerNotificationPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ResellerNotificationHttpAdapter.name);

  constructor(
    private readonly config: CustomerConfigService,
    @Inject(CUSTOMER_TOKENS.IdentityPort) private readonly identity: IdentityPort,
  ) {}

  async priceChanged(notice: ResellerPriceNotice): Promise<boolean> {
    const { crmServiceUrl, internalServiceKey } = this.config;
    if (!crmServiceUrl || !internalServiceKey) {
      this.logger.debug('Reseller price notice skipped (crm not configured)');
      return false;
    }
    try {
      const identity = (await this.identity.getCustomerNames([notice.customerId])).get(
        notice.customerId,
      );
      const phone = identity?.phone;
      if (!phone) {
        this.logger.warn(`Reseller ${notice.customerId} has no phone on file; price notice skipped`);
        return false;
      }
      const res = await fetch(`${crmServiceUrl}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          event: notice.active ? 'RESELLER_PRICE_CHANGED' : 'RESELLER_DEACTIVATED',
          phone,
          customerId: notice.customerId,
          vars: { name: identity?.fullName ?? '', terms: notice.terms },
        }),
        signal: AbortSignal.timeout(ResellerNotificationHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`crm-service responded ${res.status}`);
      return true;
    } catch (error) {
      this.logger.warn(`Reseller price notice failed: ${(error as Error).message}`);
      return false;
    }
  }
}
