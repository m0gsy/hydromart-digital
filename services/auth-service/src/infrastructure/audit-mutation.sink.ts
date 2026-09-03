import { Injectable } from '@nestjs/common';
import { AuditEvent, AuditMutationSink } from '@hydromart/platform';

import { AuditService } from '../application/services/audit.service';

/**
 * auth-service writes its own trail directly.
 *
 * The other services post to `POST /auth/audit/internal`; this one owns the table, so
 * going out over HTTP to itself would add a network hop, a shared-secret check and a
 * failure mode, to reach a repository that is already injected here.
 *
 * CA-2-67: the actions this now covers are the ones the register found missing — who
 * changed the RBAC matrix, who invited or disabled staff, who moved somebody between
 * depots. `AuditAction` above lists login and OTP events because those were the only
 * things ever recorded; a role grant left no row at all.
 */
@Injectable()
export class AuthAuditMutationSink implements AuditMutationSink {
  constructor(private readonly audit: AuditService) {}

  async record(event: AuditEvent): Promise<void> {
    await this.audit.record({
      // The trail's actor column is `customerId` — accounts and staff share one table.
      customerId: event.actorId ?? null,
      action: `auth.${event.action}`,
      success: event.success ?? true,
      // Not available to an interceptor without re-parsing the request; the actor and
      // the change itself are what a role grant has to answer for.
      ipAddress: null,
      userAgent: null,
      metadata: { ...(event.metadata ?? {}), ...(event.target ? { target: event.target } : {}) },
    });
  }
}
