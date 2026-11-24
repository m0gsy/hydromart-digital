import { loadDepotOverrides } from '@hydromart/access';
import { AuthenticatedUser, Role } from '@hydromart/platform';

import {
  PendingApprovalSourcesPort,
  PendingAsker,
  PendingQueueKey,
} from '../../src/application/ports/pending-approval-sources.port';
import {
  PENDING_QUEUES,
  PendingApprovalsService,
} from '../../src/application/services/pending-approvals.service';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const OLDEST = '2026-11-20T01:02:03.000Z';

const user = (role: Role | string, over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  sub: '99999999-9999-4999-8999-999999999999',
  role: role as Role,
  phone: null,
  depotId: null,
  ...over,
});

function make(fail: PendingQueueKey[] = []) {
  const asked: Array<[PendingQueueKey, PendingAsker]> = [];
  const sources: PendingApprovalSourcesPort = {
    count: async (queue, asker) => {
      asked.push([queue, asker]);
      if (fail.includes(queue)) throw new Error('down');
      return { count: 3, oldestAt: OLDEST };
    },
  };
  return { asked, svc: new PendingApprovalsService(sources) };
}

const keys = (r: { queues: { key: string }[] }) => r.queues.map((q) => q.key);

describe('PendingApprovalsService', () => {
  afterEach(() => loadDepotOverrides([]));

  it('answers exactly the queues the role decides, in the fixed order, with where to act', async () => {
    const { svc } = make();
    const ho = await svc.forCaller(user(Role.HEAD_OFFICE));
    expect(keys(ho)).toEqual(['priceOverrides', 'leave', 'franchiseApplications']);
    expect(ho.queues[0]).toEqual({ key: 'priceOverrides', count: 3, oldestAt: OLDEST, href: '/hq/pricing' });
    expect(keys(await svc.forCaller(user(Role.FINANCE)))).toEqual(['refunds', 'expenses', 'settlements']);
    expect(keys(await svc.forCaller(user(Role.SUPER_ADMIN)))).toEqual(PENDING_QUEUES.map((q) => q.key));
  });

  it('gives a role that decides nothing an empty list, and asks no service', async () => {
    const { svc, asked } = make();
    await expect(svc.forCaller(user(Role.SUPERVISOR, { depotIds: [D1] }))).resolves.toEqual({ queues: [] });
    expect(asked).toEqual([]);
  });

  it("holds depot queues to the caller's depots and network queues to the network", async () => {
    const { svc, asked } = make();
    const manager = user(Role.MANAGER, { depotId: D1, depotIds: [D1, D2] });
    expect(keys(await svc.forCaller(manager))).toEqual(['expenses', 'settlements', 'leave', 'kasbon', 'approvals']);
    for (const [, asker] of asked) {
      expect(asker).toEqual({ actorId: manager.sub, role: Role.MANAGER, depotIds: [D1, D2] });
    }
    asked.length = 0;
    await svc.forCaller(user(Role.SUPER_ADMIN));
    expect(asked.every(([, a]) => a.depotIds === undefined)).toBe(true);
  });

  it('leaves out a depot where the role is denied the capability, as its screen would', async () => {
    loadDepotOverrides([{ capability: 'approvals', roleKey: 'MANAGER', depotId: D2, effect: 'DENY' }]);
    const { svc, asked } = make();
    await svc.forCaller(user(Role.MANAGER, { depotId: D1, depotIds: [D1, D2] }));
    expect(asked.find(([q]) => q === 'approvals')![1].depotIds).toEqual([D1]);
    expect(asked.find(([q]) => q === 'expenses')![1].depotIds).toEqual([D1, D2]);
  });

  it("drops a queue whose capability is denied at a locked role's own depot", async () => {
    const { svc } = make();
    const cashier = user(Role.KEPALA_DEPOT, { depotId: D1 });
    expect(keys(await svc.forCaller(cashier))).toEqual(['settlements']);
    loadDepotOverrides([{ capability: 'courierSettle', roleKey: 'KEPALA_DEPOT', depotId: D1, effect: 'DENY' }]);
    expect(keys(await svc.forCaller(cashier))).toEqual([]);
  });

  it('answers 0 without asking anyone for a scoped account responsible for no depot', async () => {
    const { svc, asked } = make();
    const lonely = user(Role.MANAGER, { depotIds: [] });
    const res = await svc.forCaller(lonely);
    expect(res.queues.map((q) => [q.key, q.count])).toEqual([
      ['expenses', 0],
      ['settlements', 0],
      ['leave', 0],
      ['kasbon', 0],
      ['approvals', 0],
    ]);
    expect(asked).toEqual([]);
  });

  it('reports one unreadable queue as unavailable, never 0, and the rest still answer', async () => {
    const { svc } = make(['refunds']);
    const res = await svc.forCaller(user(Role.FINANCE));
    expect(res.queues).toEqual([
      { key: 'refunds', count: null, oldestAt: null, href: '/hq/refunds', error: 'unavailable' },
      { key: 'expenses', count: 3, oldestAt: OLDEST, href: '/dashboard/expense-claims' },
      { key: 'settlements', count: 3, oldestAt: OLDEST, href: '/dashboard/settlements' },
    ]);
  });
});
