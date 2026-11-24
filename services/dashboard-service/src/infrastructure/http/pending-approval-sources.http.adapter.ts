import { Injectable } from '@nestjs/common';

import { DashboardConfigService } from '../../config/dashboard-config.service';
import {
  PendingApprovalSourcesPort,
  PendingAsker,
  PendingCount,
  PendingQueueKey,
} from '../../application/ports/pending-approval-sources.port';

type Holder = 'depot' | 'payment' | 'payout' | 'delivery' | 'hr';

/** Which service holds each queue, and the segment of its internal count route. */
const ROUTES: Record<PendingQueueKey, { holder: Holder; segment: string }> = {
  priceOverrides: { holder: 'depot', segment: 'price-overrides' },
  refunds: { holder: 'payment', segment: 'refunds' },
  expenses: { holder: 'payout', segment: 'expenses' },
  settlements: { holder: 'delivery', segment: 'settlements' },
  leave: { holder: 'hr', segment: 'leave' },
  kasbon: { holder: 'hr', segment: 'kasbon' },
  franchiseApplications: { holder: 'depot', segment: 'franchise-applications' },
  approvals: { holder: 'depot', segment: 'approvals' },
};

/**
 * HD-11: asks each holding service, with the internal key, how many items wait for one person.
 * The person travels as data (account, role, depots), read by the caller from their verified
 * token; the key only proves the request came from this service.
 */
@Injectable()
export class PendingApprovalSourcesHttpAdapter implements PendingApprovalSourcesPort {
  private static readonly TIMEOUT_MS = 5000;

  constructor(private readonly config: DashboardConfigService) {}

  async count(queue: PendingQueueKey, asker: PendingAsker): Promise<PendingCount> {
    const { holder, segment } = ROUTES[queue];
    // payment, payout and hr are optional here (blank in a stack without them): unanswered.
    const base = {
      depot: this.config.depotServiceUrl,
      delivery: this.config.deliveryServiceUrl,
      payment: this.config.paymentServiceUrl,
      payout: this.config.payoutServiceUrl,
      hr: this.config.hrServiceUrl,
    }[holder];
    if (!base) throw new Error(`${holder}-service is not configured`);
    const params = new URLSearchParams({ actorId: asker.actorId, role: asker.role });
    if (asker.depotIds) params.set('depotIds', asker.depotIds.join(','));
    const res = await fetch(`${base}/api/v1/pending-approvals/internal/${segment}?${params}`, {
      headers: { 'x-internal-key': this.config.internalServiceKey, accept: 'application/json' },
      signal: AbortSignal.timeout(PendingApprovalSourcesHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${holder}-service answered ${res.status}`);
    return PendingApprovalSourcesHttpAdapter.parse(await res.json());
  }

  /** Only a well-formed answer becomes a number on the Command Center; anything else is "unavailable". */
  private static parse(body: unknown): PendingCount {
    const { count, oldestAt } = (body ?? {}) as { count?: unknown; oldestAt?: unknown };
    const at = typeof oldestAt === 'string' ? Date.parse(oldestAt) : Number.NaN;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new Error('the count is not a whole number');
    }
    if (oldestAt !== null && Number.isNaN(at)) throw new Error('the oldest time is not a time');
    return { count, oldestAt: oldestAt === null ? null : new Date(at).toISOString() };
  }
}
