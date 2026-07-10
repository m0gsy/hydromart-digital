import { Injectable, Logger } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import { LowStockAlert, LowStockAlertPort } from '../../application/ports/low-stock-alert.port';

/**
 * Emits a STOCK_LOW WhatsApp alert to a configured ops number via crm-service.
 * Fails OPEN: a blank alert phone / crm URL (the dev default), a missing caller token,
 * or any crm error logs and returns — a stock movement is never rolled back because its
 * alert could not be delivered.
 */
@Injectable()
export class LowStockAlertHttpAdapter implements LowStockAlertPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(LowStockAlertHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async emit(alert: LowStockAlert, authorization: string): Promise<void> {
    const phone = this.config.alertPhone;
    if (!phone || !this.config.crmServiceUrl || !authorization) {
      this.logger.debug(`Low-stock alert skipped for ${alert.label} (alerting disabled)`);
      return;
    }
    const url = `${this.config.crmServiceUrl}/api/v1/notifications`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LowStockAlertHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify({
          event: 'STOCK_LOW',
          phone,
          vars: {
            depot: alert.depotName,
            item: alert.label,
            quantity: String(alert.quantity),
            minimum: String(alert.minimum),
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`crm-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Low-stock alert for ${alert.label} skipped: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
