import { Inject, Injectable, Logger } from '@nestjs/common';

import { can, type Capability } from '@hydromart/access';
import { AuthenticatedUser, depotScopeIds, isDepotLocked } from '@hydromart/platform';

import {
  PendingApprovalSourcesPort,
  PendingQueueKey,
} from '../ports/pending-approval-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';

interface QueueDef {
  key: PendingQueueKey;
  /** Holding any of these lets the caller decide what waits here. */
  decidedWith: readonly Capability[];
  /** Its items belong to a depot, so the count is held to the caller's depots. */
  depotBound: boolean;
  /** Where the caller acts on it, in the hydromart-digital web. */
  href: string;
}

/**
 * HD-11, owner decision 24 Nov 2026: the eight queues of "jumlah persetujuan yang menunggu".
 * Refunds and franchise applications are network queues: an application has no depot, a refund
 * queue row carries none (a payment names its depot only for a counter sale), and both are
 * decided network-wide, so they are counted the way their screens list them.
 */
export const PENDING_QUEUES: readonly QueueDef[] = [
  { key: 'priceOverrides', decidedWith: ['priceOverrideDecide'], depotBound: true, href: '/hq/pricing' },
  { key: 'refunds', decidedWith: ['refundQueue'], depotBound: false, href: '/hq/refunds' },
  { key: 'expenses', decidedWith: ['expenseApprove'], depotBound: true, href: '/dashboard/expense-claims' },
  { key: 'settlements', decidedWith: ['courierSettle'], depotBound: true, href: '/dashboard/settlements' },
  { key: 'leave', decidedWith: ['leaveApprove', 'hrAdmin'], depotBound: true, href: '/hr/leave' },
  { key: 'kasbon', decidedWith: ['kasbonApprove'], depotBound: true, href: '/hr/loans/requests' },
  {
    key: 'franchiseApplications',
    decidedWith: ['franchiseApplications'],
    depotBound: false,
    href: '/hq/applications',
  },
  { key: 'approvals', decidedWith: ['approvals'], depotBound: true, href: '/dashboard/approvals' },
];

export interface PendingQueue {
  key: PendingQueueKey;
  /** Null only with `error`: the queue's service could not answer, which is not zero. */
  count: number | null;
  oldestAt: string | null;
  href: string;
  error?: 'unavailable';
}

export interface PendingApprovals {
  queues: PendingQueue[];
}

/** The depots a request naming none touches, exactly as RolesGuard reads them for @Can. */
function ownDepot(user: AuthenticatedUser): string[] | undefined {
  return isDepotLocked(user.role) && user.depotId ? [user.depotId] : undefined;
}

/**
 * The caller's depots as every staff screen resolves them: undefined for a network-wide role.
 * `depotScopeIds` refuses a scoped account with no depot at all; here that is simply nothing to
 * count at a depot, not a refusal of the whole answer.
 */
function scopeOf(user: AuthenticatedUser): readonly string[] | undefined {
  try {
    return depotScopeIds(user);
  } catch {
    return [];
  }
}

@Injectable()
export class PendingApprovalsService {
  private readonly logger = new Logger(PendingApprovalsService.name);

  constructor(
    @Inject(DASHBOARD_TOKENS.PendingApprovalSources)
    private readonly sources: PendingApprovalSourcesPort,
  ) {}

  /**
   * Every queue the caller decides, each with how many wait for them and since when. A queue
   * they do not decide is left out, not reported as 0: its size is not theirs to know. One that
   * cannot be read comes back `count: null, error: 'unavailable'`, and the rest still answer.
   */
  async forCaller(user: AuthenticatedUser): Promise<PendingApprovals> {
    const own = ownDepot(user);
    const scope = scopeOf(user);
    const decided = PENDING_QUEUES.filter((q) => q.decidedWith.some((c) => can(c, user.role, own)));
    return { queues: await Promise.all(decided.map((q) => this.answer(q, user, scope))) };
  }

  private async answer(
    q: QueueDef,
    user: AuthenticatedUser,
    scope: readonly string[] | undefined,
  ): Promise<PendingQueue> {
    // A depot where the caller's role is denied the capability is one their screen will not
    // list either (RolesGuard checks @Can against the depot a list names).
    const depotIds =
      q.depotBound && scope
        ? scope.filter((d) => q.decidedWith.some((c) => can(c, user.role, [d])))
        : undefined;
    if (depotIds?.length === 0) return { key: q.key, count: 0, oldestAt: null, href: q.href };
    try {
      const { count, oldestAt } = await this.sources.count(q.key, {
        actorId: user.sub,
        role: user.role,
        depotIds,
      });
      return { key: q.key, count, oldestAt, href: q.href };
    } catch (error) {
      this.logger.warn(`Pending ${q.key} count unavailable: ${(error as Error).message}`);
      return { key: q.key, count: null, oldestAt: null, href: q.href, error: 'unavailable' };
    }
  }
}
