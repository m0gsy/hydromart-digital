import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { OpsIncidentAlert, OpsNotifierPort } from '../../application/ports/ops-notifier.port';

/**
 * Pushes a HIGH field incident to crm-service's internal notification endpoint as
 * a COURIER_INCIDENT — it lands in the existing staff ops feed (no new ops screen).
 * Authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key). Fails OPEN: a
 * blank crm URL / internal key / ops phone (dev default), or any crm error, logs and
 * returns — an incident is already persisted; its alert is a side-effect.
 */
@Injectable()
export class OpsNotifierHttpAdapter implements OpsNotifierPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(OpsNotifierHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async incidentReported(alert: OpsIncidentAlert): Promise<void> {
    const phone = this.config.opsAlertPhone;
    const { crmServiceUrl, internalServiceKey } = this.config;
    if (!phone || !crmServiceUrl || !internalServiceKey) {
      this.logger.debug('Incident ops alert skipped (alerting disabled)');
      return;
    }
    const url = `${crmServiceUrl}/api/v1/notifications/internal`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OpsNotifierHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          event: 'COURIER_INCIDENT',
          phone,
          vars: {
            severity: alert.severity,
            category: alert.category,
            note: alert.description,
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`crm-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Incident ops alert skipped: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
