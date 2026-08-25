import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AuditLogEntry,
  AuditLogListItem,
  AuditLogRepository,
} from '../ports/audit-log.repository';
import { AUTH_TOKENS } from '../tokens';

/**
 * Depot audit category (design 8b filter chips) → action substrings matched
 * case-insensitively. Single source shared by the Prisma repo (server filter) and
 * the in-memory fake; the web console mirrors the keys for its chip labels.
 */
/*
 * Audit: five chips, three of which could not match anything. Every action that reaches this
 * trail comes from one of three places, and they are the whole list:
 *   auth-service       auth.register.* / auth.otp.* / auth.login.* / auth.token.* / auth.logout*
 *   payment-service    payment.refund.requested | rejected | settled
 *   depot-service      depot.price_override.approved | rejected | self_approve_blocked
 *
 * OPNAME ('opname', 'stock') and RECEIPT ('receipt', 'restock', 'purchase') matched none of
 * them — nothing writes stock movements to this trail — and SETORAN's words ('settlement',
 * 'cod', 'deposit', 'payout') appear in none of them either. A filter that always returns
 * nothing reads as "no such activity", which is a different claim from "not recorded here".
 *
 * What is left matches what is written. REFUND replaces SETORAN because a refund is what
 * payment-service actually records, and calling it a deposit would be the same lie in the
 * other direction.
 */
export const AUDIT_CATEGORIES: Record<string, string[]> = {
  HARGA: ['price', 'pricing', 'harga'],
  REFUND: ['refund'],
  STAF: ['staff', 'role', 'invite', 'login', 'logout'],
};

/** Security-relevant actions recorded to the audit trail. */
export enum AuditAction {
  REGISTER_REQUESTED = 'auth.register.requested',
  OTP_VERIFIED = 'auth.otp.verified',
  OTP_FAILED = 'auth.otp.failed',
  OTP_RESENT = 'auth.otp.resent',
  LOGIN_REQUESTED = 'auth.login.requested',
  LOGIN_SUCCEEDED = 'auth.login.succeeded',
  TOKEN_REFRESHED = 'auth.token.refreshed',
  TOKEN_REUSE_DETECTED = 'auth.token.reuse_detected',
  LOGOUT = 'auth.logout',
  LOGOUT_ALL = 'auth.logout_all',
  // K1.4. Two entries, not one: the request is what a hijack attempt looks like when it
  // fails, and it is the only trace of one. Both record the destination MASKED — this
  // table is read by staff, and a phone number is the identity itself.
  PHONE_CHANGE_REQUESTED = 'auth.phone.change_requested',
  PHONE_CHANGED = 'auth.phone.changed',
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
    depotId?: string;
    type?: string;
    /** Keyset cursor from the previous page's `nextCursor` (audit Q-16). */
    cursor?: string;
  }): Promise<{
    items: AuditLogListItem[];
    total: number;
    page: number;
    limit: number;
    nextCursor: string | null;
  }> {
    const page = Math.max(1, input.page);
    const limit = Math.min(AuditService.MAX_LIMIT, Math.max(1, input.limit));
    const { items, total, nextCursor } = await this.auditLog.list({
      page,
      limit,
      cursor: input.cursor,
      action: input.action,
      customerId: input.customerId,
      depotId: input.depotId,
      type: input.type,
    });
    return { items, total, page, limit, nextCursor };
  }

  /**
   * Retention enforcement: delete audit rows older than the cutoff admin-service
   * computed from the policy. Failures propagate — a sweep that swallows its error
   * would report "0 deleted" and be indistinguishable from "nothing was due".
   */
  async purgeOlderThan(cutoff: Date): Promise<{ deleted: number }> {
    const deleted = await this.auditLog.deleteOlderThan(cutoff);
    this.logger.log(`Purged ${deleted} audit rows older than ${cutoff.toISOString()}`);
    return { deleted };
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
