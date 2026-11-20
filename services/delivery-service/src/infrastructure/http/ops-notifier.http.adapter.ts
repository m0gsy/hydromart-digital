import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import {
  OpsIncidentAlert,
  OpsSettlementAlert,
  OpsNotifierPort,
  OpsSlaBreachAlert,
} from '../../application/ports/ops-notifier.port';

/** "Rp 150.000", "-Rp 5.000": the copy crm puts in front of the verifier. */
function idr(n: number): string {
  return `${n < 0 ? '-' : ''}Rp ${Math.abs(Math.round(n)).toLocaleString('id-ID')}`;
}

/**
 * Pushes operational alerts to crm-service's internal notification endpoint — they land
 * in the existing staff ops feed, so neither of these needed a new ops screen.
 * Authenticated by the shared INTERNAL_SERVICE_KEY (x-internal-key). Alerting is OFF
 * when the crm URL, the internal key or the ops phone is blank (the dev default).
 *
 * The callers want different things from a failure, and that is the only difference
 * between them (settlementSubmitted forgets, like incidentReported: the settlement is stored):
 *
 *   incidentReported  forgets. The incident row is already stored and a human is looking
 *                     at the feed; a dropped alert costs a notification, not the record.
 *   slaBreached       reports back. A breach has no row of its own — if this call is
 *                     dropped, the only thing that knew a delivery was late was this
 *                     function call, so the sweep needs the truth to retry (J8).
 */
@Injectable()
export class OpsNotifierHttpAdapter implements OpsNotifierPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(OpsNotifierHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async incidentReported(alert: OpsIncidentAlert): Promise<void> {
    await this.post('COURIER_INCIDENT', alert.depotId, {
      // Flow 6a: an id for crm's destination, never copy (no template names it).
      incidentId: alert.incidentId,
      severity: alert.severity,
      category: alert.category,
      note: alert.description,
    });
  }

  async slaBreached(alert: OpsSlaBreachAlert): Promise<boolean> {
    return this.post('DELIVERY_SLA_BREACHED', alert.depotId, {
      orderId: alert.orderId,
      order: alert.orderNumber,
      minutes: String(alert.minutes),
      threshold: String(alert.thresholdMinutes),
      over: String(alert.minutes - alert.thresholdMinutes),
    });
  }

  async settlementSubmitted(alert: OpsSettlementAlert): Promise<void> {
    await this.post('COURIER_SETTLEMENT_SUBMITTED', alert.depotId, {
      settlementId: alert.settlementId,
      amount: idr(alert.depositedAmount),
      variance: idr(alert.variance),
    });
  }

  /**
   * Returns whether crm took it. Alerting being switched off counts as success: it is a
   * configuration choice, not a failed delivery, and calling it a failure would make the
   * SLA sweep retry the same rows forever in an environment that never wanted alerts.
   */
  private async post(
    event: string,
    depotId: string | null,
    vars: Record<string, string>,
  ): Promise<boolean> {
    const phone = this.config.opsAlertPhone;
    const { crmServiceUrl, internalServiceKey } = this.config;
    if (!phone || !crmServiceUrl || !internalServiceKey) {
      this.logger.debug(`${event} ops alert skipped (alerting disabled)`);
      return true;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OpsNotifierHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${crmServiceUrl}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          event,
          phone,
          // F8: crm pushes an ops alert to the depot's own active staff. Omitted when the
          // alert carries no depot — better no push than one sent to the wrong shift.
          ...(depotId ? { depotId } : {}),
          vars,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`crm-service responded ${res.status}`);
      }
      return true;
    } catch (error) {
      this.logger.warn(`${event} ops alert failed: ${(error as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
