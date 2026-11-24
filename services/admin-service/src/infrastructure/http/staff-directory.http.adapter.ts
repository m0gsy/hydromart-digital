import { Injectable } from '@nestjs/common';

import { StaffAccount, StaffDirectoryPort } from '../../application/ports/staff-directory.port';
import { AdminConfigService } from '../../config/admin-config.service';

/**
 * auth-service `POST auth/internal/customers/by-ids` (internal key), at most 200 ids a call.
 * The email is the login's own, the address /hq/profile shows and the person edits. THROWS
 * on any failure, unconfigured included: without the directory nobody can be written to.
 */
@Injectable()
export class StaffDirectoryHttpAdapter implements StaffDirectoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private static readonly BY_IDS_MAX = 200;

  constructor(private readonly config: AdminConfigService) {}

  async accountsByIds(ids: readonly string[]): Promise<StaffAccount[]> {
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new Error('auth-service URL or internal key missing');
    const out: StaffAccount[] = [];
    for (let i = 0; i < ids.length; i += StaffDirectoryHttpAdapter.BY_IDS_MAX) {
      const res = await fetch(`${base}/api/v1/auth/internal/customers/by-ids`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ ids: ids.slice(i, i + StaffDirectoryHttpAdapter.BY_IDS_MAX) }),
        signal: AbortSignal.timeout(StaffDirectoryHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`auth-service responded ${res.status}`);
      const rows = (await res.json()) as unknown;
      for (const row of Array.isArray(rows) ? rows : []) {
        const { id, email, role, status } = (row ?? {}) as Record<string, unknown>;
        if (typeof id === 'string' && typeof role === 'string' && typeof status === 'string') {
          out.push({ id, role, status, email: typeof email === 'string' ? email : null });
        }
      }
    }
    return out;
  }
}
