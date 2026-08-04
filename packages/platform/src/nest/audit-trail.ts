import { Logger } from '@nestjs/common';

/**
 * Client for auth-service's cross-service audit ingest (`POST /api/v1/auth/audit/internal`).
 *
 * H-29: the audit trail existed and had an internal ingest endpoint, but **nothing called
 * it** — every entry in the table came from auth-service's own login/OTP/token events. So
 * the two decisions the business most needs a name and a timestamp against, refunds and
 * price-override approvals, left no record at all. Who approved a Rp 2,000,000 refund was
 * answerable only from an application log line that rotates.
 *
 * It lives here rather than in one service because it is the same three lines in every
 * caller and the register asks for a trail, not two trails.
 *
 * **Fail-open, deliberately.** Auditing must not be able to reject a refund that already
 * settled or a price change that already applied. That is a real limitation, not an
 * oversight: a dropped entry is a gap in the record. It is logged at `error` so the gap is
 * visible, and the honest fix if the trail ever becomes evidential is to write it in the
 * same transaction as the decision — which needs the trail to live in the deciding
 * service's database, not over HTTP.
 */
export interface AuditTrailConfig {
  /** auth-service base URL, no trailing slash. Blank disables recording. */
  authServiceUrl: string;
  /** Shared internal key. Blank disables recording. */
  internalServiceKey: string;
}

export interface AuditEvent {
  /** Dotted action name, e.g. `payment.refund.approved`. */
  action: string;
  /** Acting account id; null for a system-driven decision. */
  actorId?: string | null;
  /** Human-readable subject, e.g. the payment reference or the depot + product. */
  target?: string;
  /** False when the attempt was refused — a rejected approval is still a decision. */
  success?: boolean;
  /** Non-sensitive structured context: amounts, before/after, reason. */
  metadata?: Record<string, unknown>;
}

const TIMEOUT_MS = 5000;

/**
 * Records one privileged action. Never throws.
 *
 * `logger` is the calling service's own, so a dropped entry is attributed to the code
 * that owed it rather than to a shared helper nobody owns.
 */
export async function recordAuditEvent(
  config: AuditTrailConfig,
  event: AuditEvent,
  logger: Logger,
): Promise<void> {
  const base = config.authServiceUrl.replace(/\/+$/, '');
  if (!base || !config.internalServiceKey) {
    // Not configured in this environment (local, tests). Silent: warning on every
    // refund in a dev stack trains people to ignore the log.
    return;
  }
  try {
    const res = await fetch(`${base}/api/v1/auth/audit/internal`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': config.internalServiceKey,
      },
      body: JSON.stringify({
        actorId: event.actorId ?? undefined,
        action: event.action,
        target: event.target,
        success: event.success ?? true,
        metadata: event.metadata,
      }),
      // stdlib timeout — no manual timer to create, clear, or leak.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`auth-service responded ${res.status}`);
    }
  } catch (error) {
    logger.error(
      `Audit entry "${event.action}" was NOT recorded (${(error as Error).message}) — ` +
        `target=${event.target ?? 'n/a'} actor=${event.actorId ?? 'system'}`,
    );
  }
}
