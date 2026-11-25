import { Injectable, Logger } from '@nestjs/common';

import { StaffHrEmailPort } from '../../application/ports/staff-hr-email.port';
import { AdminConfigService } from '../../config/admin-config.service';

/**
 * hr-service `POST employees/internal/emails-by-accounts` (internal key), at most 200 ids a
 * call. THROWS when unconfigured; a failed batch is logged (no addresses) and skipped, so the
 * batches that answered still count and the caller falls back to login emails for the rest.
 */
@Injectable()
export class StaffHrEmailHttpAdapter implements StaffHrEmailPort {
  private static readonly TIMEOUT_MS = 5000;
  private static readonly MAX = 200;
  private readonly logger = new Logger(StaffHrEmailHttpAdapter.name);

  constructor(private readonly config: AdminConfigService) {}

  async emailsByAccounts(ids: readonly string[]): Promise<{ accountId: string; email: string }[]> {
    const base = this.config.peerUrl('HR_SERVICE_URL');
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new Error('hr-service URL or internal key missing');
    const out: { accountId: string; email: string }[] = [];
    for (let i = 0; i < ids.length; i += StaffHrEmailHttpAdapter.MAX) {
      try {
        const res = await fetch(`${base}/api/v1/employees/internal/emails-by-accounts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-key': key },
          body: JSON.stringify({ accountIds: ids.slice(i, i + StaffHrEmailHttpAdapter.MAX) }),
          signal: AbortSignal.timeout(StaffHrEmailHttpAdapter.TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`hr-service responded ${res.status}`);
        const rows = (await res.json()) as unknown;
        for (const row of Array.isArray(rows) ? rows : []) {
          const { accountId, email } = (row ?? {}) as Record<string, unknown>;
          if (typeof accountId === 'string' && typeof email === 'string' && email.trim()) {
            out.push({ accountId, email: email.trim() });
          }
        }
      } catch (err) {
        this.logger.warn(
          `hr-service email lookup failed for ${ids.slice(i, i + StaffHrEmailHttpAdapter.MAX).length} accounts: ${(err as Error).message.replace(/\S+@\S+/g, '<address>')}`,
        );
      }
    }
    return out;
  }
}
