import { Injectable, Logger } from '@nestjs/common';
import {
  AuditEvent,
  AuditMutationSink,
  recordAuditEvent,
  recordAuditEventOrThrow,
} from '@hydromart/platform';

import { CrmConfigService } from '../../config/crm-config.service';

/**
 * crm-service's half of the shared audit trail (AI-5), the same as admin-service's: rows go to
 * auth-service's internal ingest. Its first writer is the machine-only notification route, where
 * AuditMutationsInterceptor records n8n's call before it runs and refuses it when it cannot.
 */
@Injectable()
export class CrmAuditSink implements AuditMutationSink {
  private readonly logger = new Logger(CrmAuditSink.name);

  constructor(private readonly config: CrmConfigService) {}

  async record(event: AuditEvent): Promise<void> {
    await recordAuditEvent(
      {
        authServiceUrl: this.config.authServiceUrl,
        internalServiceKey: this.config.internalServiceKey,
      },
      // The trail is read across services, so the action carries the service that owns it.
      { ...event, action: `crm.${event.action}` },
      this.logger,
    );
  }

  /** HD-2: a change by the AI web or a machine account runs only once its row is stored. */
  async recordOrThrow(event: AuditEvent): Promise<void> {
    await recordAuditEventOrThrow(
      {
        authServiceUrl: this.config.authServiceUrl,
        internalServiceKey: this.config.internalServiceKey,
      },
      { ...event, action: `crm.${event.action}` },
    );
  }
}
