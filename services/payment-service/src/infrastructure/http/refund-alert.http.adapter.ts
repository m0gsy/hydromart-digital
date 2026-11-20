import { Injectable, Logger } from '@nestjs/common';

import { RefundAlertPort, RefundRequestedAlert } from '../../application/ports/refund-alert.port';
import { PaymentConfigService } from '../../config/payment-config.service';

const idr = (n: number): string => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

@Injectable()
export class RefundAlertHttpAdapter implements RefundAlertPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(RefundAlertHttpAdapter.name);

  constructor(private readonly config: PaymentConfigService) {}

  async requested(alert: RefundRequestedAlert): Promise<void> {
    const { crmServiceUrl, internalServiceKey, opsAlertPhone } = this.config;
    if (!crmServiceUrl || !internalServiceKey || !opsAlertPhone) {
      this.logger.debug('Refund alert skipped (alerting disabled)');
      return;
    }
    try {
      const res = await fetch(`${crmServiceUrl}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          event: 'REFUND_REQUESTED',
          phone: opsAlertPhone,
          ...(alert.depotId ? { depotId: alert.depotId } : {}),
          vars: { paymentId: alert.paymentId, amount: idr(alert.amount) },
        }),
        signal: AbortSignal.timeout(RefundAlertHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`crm-service responded ${res.status}`);
    } catch (e) {
      this.logger.warn(`Refund alert for ${alert.paymentId} skipped: ${(e as Error).message}`);
    }
  }
}
