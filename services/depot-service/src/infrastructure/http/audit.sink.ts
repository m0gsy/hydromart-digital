import { Injectable, Logger } from '@nestjs/common';
import {
  AuditEvent,
  AuditMutationSink,
  recordAuditEvent,
  recordAuditEventOrThrow,
} from '@hydromart/platform';

import { DepotConfigService } from '../../config/depot-config.service';

/**
 * depot-service's half of the shared audit trail (HD-17), the same as crm-service's: rows go to
 * auth-service's internal ingest. Its first writer is the AI draft routes, where
 * AuditMutationsInterceptor records the AI web's call before it runs and refuses it when it cannot.
 */
@Injectable()
export class DepotAuditSink implements AuditMutationSink {
  private readonly logger = new Logger(DepotAuditSink.name);

  constructor(private readonly config: DepotConfigService) {}

  private target() {
    return {
      authServiceUrl: this.config.authServiceUrl,
      internalServiceKey: this.config.internalServiceKey,
    };
  }

  async record(event: AuditEvent): Promise<void> {
    // The trail is read across services, so the action carries the service that owns it.
    await recordAuditEvent(
      this.target(),
      { ...event, action: `depot.${event.action}` },
      this.logger,
    );
  }

  /** HD-2: a change by the AI web runs only once its row is stored. */
  async recordOrThrow(event: AuditEvent): Promise<void> {
    await recordAuditEventOrThrow(this.target(), { ...event, action: `depot.${event.action}` });
  }
}
