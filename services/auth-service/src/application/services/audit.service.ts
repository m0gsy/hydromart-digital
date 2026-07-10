import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditLogEntry, AuditLogRepository } from '../ports/audit-log.repository';
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
}
