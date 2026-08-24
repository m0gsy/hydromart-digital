import { Injectable, Logger } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import {
  UntrackedSaleAlert,
  UntrackedSaleAlertPort,
} from '../../application/ports/untracked-sale-alert.port';

/**
 * Emits a STOCK_UNTRACKED ops alert through crm-service's internal notification
 * endpoint, authenticated by the shared INTERNAL_SERVICE_KEY. Same fail-open contract
 * as LowStockAlertHttpAdapter: a blank phone / crm URL / key, or any crm error, logs
 * and returns — an order is never rolled back because its warning could not be sent.
 */
@Injectable()
export class UntrackedSaleAlertHttpAdapter implements UntrackedSaleAlertPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(UntrackedSaleAlertHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async emit(alert: UntrackedSaleAlert, _authorization: string): Promise<void> {
    const phone = this.config.alertPhone;
    const { internalServiceKey } = this.config;
    if (!phone || !this.config.crmServiceUrl || !internalServiceKey) {
      this.logger.debug(
        `Untracked-sale alert skipped for order ${alert.orderId} (alerting disabled)`,
      );
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UntrackedSaleAlertHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${this.config.crmServiceUrl}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          event: 'STOCK_UNTRACKED',
          phone,
          vars: {
            depot: alert.depotName,
            order: alert.orderId,
            count: String(alert.productIds.length),
            // K2.6: the words, not the enum. This lands in a WhatsApp message an operator
            // reads on a phone, and 'COMPLETION' means nothing to them.
            stage: alert.stage === 'CHECKOUT' ? 'Saat pesanan masuk' : 'Saat pesanan selesai',
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`crm-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Untracked-sale alert for order ${alert.orderId} skipped: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
