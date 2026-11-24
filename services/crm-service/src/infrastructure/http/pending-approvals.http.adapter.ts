import { Injectable } from '@nestjs/common';

import {
  PendingApprovalsPort,
  PendingQueueAnswer,
} from '../../application/ports/pending-approvals.port';
import { CrmConfigService } from '../../config/crm-config.service';

/** dashboard-service `GET dashboard/internal/pending-approvals`, internal key. Throws when it cannot answer. */
@Injectable()
export class PendingApprovalsHttpAdapter implements PendingApprovalsPort {
  // dashboard asks each holding service for up to 5 s, in parallel.
  private static readonly TIMEOUT_MS = 12_000;

  constructor(private readonly config: CrmConfigService) {}

  async forAccount(accountId: string, role: string): Promise<PendingQueueAnswer[]> {
    const base = this.config.dashboardServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new Error('dashboard-service URL or internal key missing');
    const query = new URLSearchParams({ accountId, role });
    const res = await fetch(`${base}/api/v1/dashboard/internal/pending-approvals?${query}`, {
      headers: { 'x-internal-key': key },
      signal: AbortSignal.timeout(PendingApprovalsHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`dashboard-service responded ${res.status}`);
    const body = (await res.json()) as { queues?: unknown };
    if (!Array.isArray(body.queues)) throw new Error('dashboard-service answered something malformed');
    return body.queues.map((q: Record<string, unknown>) => ({
      key: String(q.key),
      count: typeof q.count === 'number' ? q.count : null,
      oldestAt: typeof q.oldestAt === 'string' ? q.oldestAt : null,
      href: String(q.href),
      ...(q.error === 'unavailable' || typeof q.count !== 'number' ? { error: 'unavailable' as const } : {}),
    }));
  }
}
