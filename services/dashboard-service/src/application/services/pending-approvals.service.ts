import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { can, currentDepotOverrides, type Capability } from '@hydromart/access';
import { AuthenticatedUser, Role, depotScopeIds, effectiveScope, isDepotLocked } from '@hydromart/platform';

import { DashboardSourcesPort } from '../ports/dashboard-sources.port';

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
    @Inject(DASHBOARD_TOKENS.Sources) private readonly depots: DashboardSourcesPort,
  ) {}

  /**
   * Every queue the caller decides, each with how many wait for them and since when. A queue
   * they do not decide is left out, not reported as 0: its size is not theirs to know. One that
   * cannot be read comes back `count: null, error: 'unavailable'`, and the rest still answer.
   */
  async forCaller(user: AuthenticatedUser): Promise<PendingApprovals> {
    const own = isDepotLocked(user.role) && user.depotId ? [user.depotId] : undefined;
    const scope = scopeOf(user);
    // The network's depots, read at most once and only when a depot-level override makes
    // "every depot" something to walk rather than something to say.
    let network: Promise<readonly string[] | null> | undefined;
    const networkDepots = (): Promise<readonly string[] | null> =>
      (network ??= this.depots.allDepots('').then(
        (all) => (all ? all.map((d) => d.id) : null),
        () => null,
      ));
    const rows = await Promise.all(
      PENDING_QUEUES.map((q) => this.answer(q, user, own, scope, networkDepots)),
    );
    return { queues: rows.filter((r): r is PendingQueue => r !== null) };
  }

  /**
   * AI-9: the same answer for another account, asked by crm for the morning summary with the
   * internal key (no token to read the depots from). Only a network-wide role is answerable: a
   * depot-scoped one needs its resolved depots, and an empty scope would read as "0 waiting".
   */
  async forAccount(accountId: string, role: string): Promise<PendingApprovals> {
    if (effectiveScope(role) !== 'GLOBAL') {
      throw new BadRequestException('Only a network-wide role can be asked for another account');
    }
    return this.forCaller({ sub: accountId, role: role as Role, phone: null, depotId: null });
  }

  /** Null: the caller does not decide this queue at all, so it is left out of the answer. */
  private async answer(
    q: QueueDef,
    user: AuthenticatedUser,
    own: string[] | undefined,
    scope: readonly string[] | undefined,
    networkDepots: () => Promise<readonly string[] | null>,
  ): Promise<PendingQueue | null> {
    let depotIds: readonly string[] | undefined;
    if (!q.depotBound) {
      if (!q.decidedWith.some((c) => can(c, user.role, own))) return null;
    } else {
      // The queue is the caller's when the role holds a capability of it with no depot named,
      // or a depot-level GRANT opens it somewhere; a depot where the role is DENIED the
      // capability is one its screen will not list either (RolesGuard checks @Can against the
      // depot a list names), so it is left out of the count.
      const held = q.decidedWith.some((c) => can(c, user.role));
      const overridden = currentDepotOverrides().filter(
        (o) => o.roleKey === user.role && (q.decidedWith as readonly string[]).includes(o.capability),
      );
      if (!held && !overridden.some((o) => o.effect === 'GRANT')) return null;
      // Fast path: a network-wide role no depot override touches is asked network-wide.
      let candidates: readonly string[] | null | undefined = scope;
      if (candidates === undefined && overridden.length > 0) candidates = await networkDepots();
      if (candidates === null) {
        return { key: q.key, count: null, oldestAt: null, href: q.href, error: 'unavailable' };
      }
      depotIds = candidates?.filter((d) => q.decidedWith.some((c) => can(c, user.role, [d])));
      if (!held && depotIds?.length === 0) return null;
    }
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
