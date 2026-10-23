import { Injectable, Logger } from '@nestjs/common';

import { AccountRolesPort } from '../../application/ports/account-roles.port';
import { DepotConfigService } from '../../config/depot-config.service';

/**
 * Reads roles through auth-service's internal batch lookup
 * (`POST /auth/internal/customers/by-ids`, the same one the name directory uses), so no new
 * route exists for this. Internal-key auth: there is no caller, an approval is raised by a
 * stock count or a gallon return.
 *
 * Answers null on ANY failure and says why in the log, so a misconfigured URL is visible and
 * never looks like a chain with nobody on it.
 */
@Injectable()
export class AccountRolesHttpAdapter implements AccountRolesPort {
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(AccountRolesHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async rolesOf(accountIds: readonly string[]): Promise<Map<string, string> | null> {
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      this.logger.warn('account roles not resolved: auth-service URL or internal key missing');
      return null;
    }
    if (accountIds.length === 0) return new Map();
    try {
      const res = await fetch(`${base}/api/v1/auth/internal/customers/by-ids`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ ids: accountIds }),
        signal: AbortSignal.timeout(AccountRolesHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`account roles lookup responded ${res.status}`);
        return null;
      }
      const rows = (await res.json()) as unknown;
      const roles = new Map<string, string>();
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const r = row as { id?: unknown; role?: unknown };
          if (typeof r?.id === 'string' && typeof r?.role === 'string') roles.set(r.id, r.role);
        }
      }
      return roles;
    } catch (error) {
      this.logger.warn(`account roles lookup failed: ${(error as Error).message}`);
      return null;
    }
  }
}
