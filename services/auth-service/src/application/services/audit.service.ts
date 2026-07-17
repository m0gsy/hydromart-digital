import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AuditLogEntry,
  AuditLogListItem,
  AuditLogRepository,
} from '../ports/audit-log.repository';
import { AUTH_TOKENS } from '../tokens';

/** Security-relevant actions recorded to the audit trail. */
export enum AuditAction {
  REGISTER_REQUESTED = 'auth.register.requested',
  OTP_VERIFIED = 'auth.otp.verified',
  OTP_FAILED = 'auth.otp.failed',
  OTP_RESENT = 'auth.otp.resent',
  LOGIN_REQUESTED = 'auth.login.requested',
  LOGIN_SUCCEEDED = 'auth.login.succeeded',
  GOOGLE_SIGNIN = 'auth.google.signin',
  TOKEN_REFRESHED = 'auth.token.refreshed',
  TOKEN_REUSE_DETECTED = 'auth.token.reuse_detected',
  LOGOUT = 'auth.logout',
  LOGOUT_ALL = 'auth.logout_all',
}

/**
 * Records the audit trail. Auditing must never break the primary flow, so failures
 * are swallowed and logged rather than propagated.
 */
@Injectable()
export class AuditService {
  private static readonly MAX_LIMIT = 100;
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(AUTH_TOKENS.AuditLogRepository) private readonly auditLog: AuditLogRepository,
  ) {}

  async record(entry: AuditLogEntry): Promise<void> {
    try {
      await this.auditLog.record(entry);
    } catch (error) {
      this.logger.error(
        `Failed to persist audit entry "${entry.action}": ${(error as Error).message}`,
      );
    }
  }

  /**
   * HQ audit list (feature 8a): recent privileged actions, newest first, paginated,
   * with the actor's identity resolved. Unlike {@link record}, read failures DO
   * propagate — a broken list must surface, not be silently swallowed.
   */
  async list(input: {
    page: number;
    limit: number;
    action?: string;
    customerId?: string;
  }): Promise<{ items: AuditLogListItem[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, input.page);
    const limit = Math.min(AuditService.MAX_LIMIT, Math.max(1, input.limit));
    const { items, total } = await this.auditLog.list({
      page,
      limit,
      action: input.action,
      customerId: input.customerId,
    });
    return { items, total, page, limit };
  }

  /**
   * Cross-service ingest: another service records a privileged action it performed
   * (e.g. depot suspend, franchise approve). The optional `target` is folded into
   * metadata so the model stays as-is. Recorded through the append-only trail.
   */
  async ingest(input: {
    actorId: string | null;
    action: string;
    target?: string | null;
    success?: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const metadata =
      input.target != null && input.target !== ''
        ? { ...(input.metadata ?? {}), target: input.target }
        : input.metadata;
    // Ingest bypasses record()'s swallow: the caller is a service and should learn
    // if the write failed, so the error propagates to the internal endpoint.
    await this.auditLog.record({
      customerId: input.actorId,
      action: input.action,
      success: input.success ?? true,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata,
    });
  }
}
