import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent, AuditMutationSink, recordAuditEvent } from '@hydromart/platform';

import { AdminConfigService } from '../../config/admin-config.service';

/**
 * admin-service's half of the shared audit trail.
 *
 * CA-2-67 measured it plainly: this service owns the API keys that authenticate partner
 * traffic, the feature flags, the webhook endpoints and the security policy — and it had
 * no audit client of any kind, while the cross-service ingest endpoint it needed had been
 * live since H-29 and was already used by payment-service and depot-service. Every one of
 * those changes was answerable only from a container log line that rotates.
 */
@Injectable()
export class AdminAuditSink implements AuditMutationSink {
  private readonly logger = new Logger(AdminAuditSink.name);

  constructor(private readonly config: AdminConfigService) {}

  async record(event: AuditEvent): Promise<void> {
    await recordAuditEvent(
      {
        authServiceUrl: this.config.authServiceUrl,
        internalServiceKey: this.config.internalServiceKey,
      },
      // The trail is read across services, so the action carries the service that owns it.
      { ...event, action: `admin.${event.action}` },
      this.logger,
    );
  }
}
