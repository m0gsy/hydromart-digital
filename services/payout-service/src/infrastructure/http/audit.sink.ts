import { Injectable, Logger } from '@nestjs/common';
import {
  AuditEvent,
  AuditMutationSink,
  recordAuditEvent,
  recordAuditEventOrThrow,
} from '@hydromart/platform';

/**
 * payout-service's half of the shared audit trail (HD-23): rows go to auth-service's internal
 * ingest, as crm-service's do. Its writers are the partner-bill routes; the machine route's call
 * is recorded BEFORE it runs and refused when it cannot be.
 */
@Injectable()
export class PayoutAuditSink implements AuditMutationSink {
  private readonly logger = new Logger(PayoutAuditSink.name);

  private get target() {
    return {
      authServiceUrl: process.env.AUTH_SERVICE_URL ?? '',
      internalServiceKey: process.env.INTERNAL_SERVICE_KEY ?? '',
    };
  }

  async record(event: AuditEvent): Promise<void> {
    await recordAuditEvent(this.target, { ...event, action: `payout.${event.action}` }, this.logger);
  }

  /** A change by the AI web or a machine account runs only once its row is stored. */
  async recordOrThrow(event: AuditEvent): Promise<void> {
    await recordAuditEventOrThrow(this.target, { ...event, action: `payout.${event.action}` });
  }
}
