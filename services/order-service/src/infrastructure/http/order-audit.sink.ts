import { Injectable, Logger } from '@nestjs/common';
import {
  AuditEvent,
  AuditMutationSink,
  recordAuditEvent,
  recordAuditEventOrThrow,
} from '@hydromart/platform';

import { OrderConfigService } from '../../config/order-config.service';

/**
 * order-service's half of the shared audit trail (HD-18), the same as crm-service's: rows go to
 * auth-service's internal ingest. Its first writer is the machine-only order-status route, where
 * AuditMutationsInterceptor records n8n's call before it runs and refuses it when it cannot.
 */
@Injectable()
export class OrderAuditSink implements AuditMutationSink {
  private readonly logger = new Logger(OrderAuditSink.name);

  constructor(private readonly config: OrderConfigService) {}

  private get target() {
    return { authServiceUrl: this.config.authServiceUrl, internalServiceKey: this.config.internalServiceKey };
  }

  async record(event: AuditEvent): Promise<void> {
    await recordAuditEvent(this.target, { ...event, action: `order.${event.action}` }, this.logger);
  }

  async recordOrThrow(event: AuditEvent): Promise<void> {
    await recordAuditEventOrThrow(this.target, { ...event, action: `order.${event.action}` });
  }
}
