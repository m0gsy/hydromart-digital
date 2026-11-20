import { Injectable, Logger } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import {
  PriceOverrideAlert,
  PriceOverrideAlertPort,
} from '../../application/ports/price-override-alert.port';

/** The same channel and the same "never fail the write" rule as the low-stock alert. */
@Injectable()
export class PriceOverrideAlertHttpAdapter implements PriceOverrideAlertPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(PriceOverrideAlertHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async emit(alert: PriceOverrideAlert): Promise<void> {
    const phone = this.config.alertPhone;
    const { internalServiceKey, crmServiceUrl } = this.config;
    if (!phone || !crmServiceUrl || !internalServiceKey) {
      this.logger.debug('Price-override alert skipped (alerting disabled)');
      return;
    }
    try {
      const res = await fetch(`${crmServiceUrl}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          event: 'PRICE_OVERRIDE_PROPOSED',
          phone,
          depotId: alert.depotId,
          vars: { depot: alert.depotName, count: String(alert.count), product: alert.product },
        }),
        signal: AbortSignal.timeout(PriceOverrideAlertHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`crm-service responded ${res.status}`);
    } catch (error) {
      this.logger.warn(`Price-override alert for ${alert.depotName} skipped: ${(error as Error).message}`);
    }
  }
}
