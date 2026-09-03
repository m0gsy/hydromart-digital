import { Injectable, Logger } from '@nestjs/common';

import { SecurityPolicyPort } from '../../application/ports/security-policy.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * Reads the security policy from admin-service, cached, and fails open.
 *
 * CA-2-06. Two things make this safe to put on the refresh path:
 *
 * **A cache**, because refresh is one of the hottest routes in the system and it must not
 * grow a cross-service round trip per call. The TTL is short enough that tightening the
 * policy takes effect within a minute and long enough that admin-service is not asked
 * thousands of times a minute.
 *
 * **Failing open**, because the alternative is worse than the bug being fixed. If
 * admin-service is unreachable this returns `null` — no idle limit — and every session
 * keeps working. A security control that logs the whole business out when the service
 * holding it restarts is an outage wearing a policy's clothes. The env-driven refresh TTL
 * still bounds every session, so the floor is a weaker limit, never none.
 *
 * The failure is logged at `warn` rather than swallowed: a policy that silently stopped
 * applying is exactly the state CA-2-06 is about.
 */
@Injectable()
export class SecurityPolicyHttpAdapter implements SecurityPolicyPort {
  private static readonly TIMEOUT_MS = 3000;
  /** Long enough to spare admin-service, short enough that a tightened policy bites soon. */
  private static readonly CACHE_MS = 60_000;
  private readonly logger = new Logger(SecurityPolicyHttpAdapter.name);
  private cached: { at: number; minutes: number | null } | null = null;

  constructor(private readonly config: AuthConfigService) {}

  async idleTimeoutMinutes(): Promise<number | null> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < SecurityPolicyHttpAdapter.CACHE_MS) {
      return this.cached.minutes;
    }
    const minutes = await this.read();
    this.cached = { at: now, minutes };
    return minutes;
  }

  private async read(): Promise<number | null> {
    const { adminServiceUrl, internalServiceKey } = this.config.securityPolicySource;
    if (!adminServiceUrl || !internalServiceKey) {
      // Not configured in this environment (local, tests). Silent: a warning on every
      // refresh in a dev stack trains people to ignore the log.
      return null;
    }
    try {
      const res = await fetch(`${adminServiceUrl}/api/v1/security-policy/internal`, {
        headers: { 'x-internal-key': internalServiceKey },
        signal: AbortSignal.timeout(SecurityPolicyHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`admin-service responded ${res.status}`);
      const body = (await res.json()) as { idleTimeoutMinutes?: number };
      const minutes = Number(body.idleTimeoutMinutes);
      // Zero or a nonsense value means "no limit" rather than "log everybody out now".
      return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
    } catch (error) {
      this.logger.warn(
        `Idle-session limit not applied — security policy unreadable: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
