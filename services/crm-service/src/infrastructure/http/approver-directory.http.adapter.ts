import { Injectable } from '@nestjs/common';

import { ApproverDirectoryPort } from '../../application/ports/approver-directory.port';
import { CrmConfigService } from '../../config/crm-config.service';

/** auth-service's internal routes; the by-ids route takes at most 200 ids a call. */
@Injectable()
export class ApproverDirectoryHttpAdapter implements ApproverDirectoryPort {
  private static readonly TIMEOUT_MS = 3000;
  private static readonly BY_IDS_MAX = 200;

  constructor(private readonly config: CrmConfigService) {}

  async staffIdsByRoles(roles: readonly string[]): Promise<string[]> {
    if (roles.length === 0) return [];
    const body = await this.post<{ ids?: unknown }>('staff/by-roles', { roles });
    return Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string') : [];
  }

  async rolesOf(ids: readonly string[]): Promise<Map<string, string>> {
    const roles = new Map<string, string>();
    for (let i = 0; i < ids.length; i += ApproverDirectoryHttpAdapter.BY_IDS_MAX) {
      const chunk = ids.slice(i, i + ApproverDirectoryHttpAdapter.BY_IDS_MAX);
      const rows = await this.post<unknown>('customers/by-ids', { ids: chunk });
      for (const row of Array.isArray(rows) ? rows : []) {
        const { id, role } = (row ?? {}) as { id?: unknown; role?: unknown };
        if (typeof id === 'string' && typeof role === 'string') roles.set(id, role);
      }
    }
    return roles;
  }

  /** A suspended, deleted or unverified account reads as no account (null), like an unknown id. */
  async profileOf(id: string): Promise<{ fullName: string | null; role: string } | null> {
    const rows = await this.post<unknown>('customers/by-ids', { ids: [id] });
    const row = (Array.isArray(rows) ? rows : []).find((r) => (r ?? {}).id === id) as
      | { fullName?: unknown; role?: unknown; status?: unknown }
      | undefined;
    if (!row || typeof row.role !== 'string') return null;
    if (typeof row.status === 'string' && row.status !== 'ACTIVE') return null;
    return { fullName: typeof row.fullName === 'string' && row.fullName.trim() ? row.fullName : null, role: row.role };
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new Error('auth-service URL or internal key missing');
    const res = await fetch(`${base}/api/v1/auth/internal/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ApproverDirectoryHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`auth-service responded ${res.status}`);
    return (await res.json()) as T;
  }
}
