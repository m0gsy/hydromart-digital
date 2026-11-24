import { loadCustomRoles, loadDepotOverrides, loadRoleSettings } from '@hydromart/access';
import { AuthenticatedUser, Role } from '@hydromart/platform';

import { DashboardSourcesPort } from '../../src/application/ports/dashboard-sources.port';

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
const D3 = '33333333-3333-4333-8333-333333333333';
const OLDEST = '2026-11-20T01:02:03.000Z';

const user = (role: Role | string, over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  sub: '99999999-9999-4999-8999-999999999999',
  role: role as Role,
  phone: null,
  depotId: null,
  ...over,
});

/** network: the depots the network has; null or 'THROW' is a depot list that cannot be read. */
function make(fail: PendingQueueKey[] = [], network: string[] | null | 'THROW' = [D1, D2, D3]) {
  const listed = { calls: 0 };
  const depots = {
    allDepots: async () => {
      listed.calls += 1;
      if (network === 'THROW') throw new Error('depot-service down');
      return network && network.map((id) => ({ id, code: id, name: id, active: true, ownershipType: 'OWN' }));
    },
  } as unknown as DashboardSourcesPort;
  const asked: Array<[PendingQueueKey, PendingAsker]> = [];
  const sources: PendingApprovalSourcesPort = {
    count: async (queue, asker) => {
      asked.push([queue, asker]);
      if (fail.includes(queue)) throw new Error('down');
      return { count: 3, oldestAt: OLDEST };
    },
  };
  return { asked, listed, svc: new PendingApprovalsService(sources, depots) };
}

const keys = (r: { queues: { key: string }[] }) => r.queues.map((q) => q.key);

describe('PendingApprovalsService', () => {
  afterEach(() => {
    loadDepotOverrides([]);
    loadCustomRoles([]);
    loadRoleSettings([]);
  });

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

  it('counts 0 for a locked role denied the capability at its own depot, and asks no one', async () => {
    const { svc, asked, listed } = make();
    const cashier = user(Role.KEPALA_DEPOT, { depotId: D1 });
    expect(keys(await svc.forCaller(cashier))).toEqual(['settlements']);
    loadDepotOverrides([{ capability: 'courierSettle', roleKey: 'KEPALA_DEPOT', depotId: D1, effect: 'DENY' }]);
    asked.length = 0;
    const res = await svc.forCaller(cashier);
    expect(res.queues).toEqual([{ key: 'settlements', count: 0, oldestAt: null, href: '/dashboard/settlements' }]);
    expect(asked).toEqual([]);
    expect(listed.calls).toBe(0);
  });

  it('sends a network-wide role no depot list, and reads none, while no override touches its queue', async () => {
    loadDepotOverrides([
      { capability: 'expenseApprove', roleKey: 'MANAGER', depotId: D1, effect: 'DENY' },
      { capability: 'approvals', roleKey: 'FINANCE', depotId: D1, effect: 'GRANT' },
    ]);
    const { svc, asked, listed } = make();
    await svc.forCaller(user(Role.HEAD_OFFICE));
    expect(asked.every(([, a]) => a.depotIds === undefined)).toBe(true);
    expect(listed.calls).toBe(0);
  });

  it('holds a network-wide role to the depots that do not deny it, listing the network once', async () => {
    loadDepotOverrides([
      { capability: 'expenseApprove', roleKey: 'FINANCE', depotId: D2, effect: 'DENY' },
      { capability: 'courierSettle', roleKey: 'FINANCE', depotId: D1, effect: 'DENY' },
    ]);
    const { svc, asked, listed } = make();
    const res = await svc.forCaller(user(Role.FINANCE));
    expect(keys(res)).toEqual(['refunds', 'expenses', 'settlements']);
    expect(asked.find(([q]) => q === 'expenses')![1].depotIds).toEqual([D1, D3]);
    expect(asked.find(([q]) => q === 'settlements')![1].depotIds).toEqual([D2, D3]);
    expect(asked.find(([q]) => q === 'refunds')![1].depotIds).toBeUndefined();
    expect(listed.calls).toBe(1);
  });

  it('counts 0 for a network-wide role denied at every depot, without asking the service', async () => {
    loadDepotOverrides(
      [D1, D2, D3].map((depotId) => ({
        capability: 'expenseApprove',
        roleKey: 'FINANCE',
        depotId,
        effect: 'DENY' as const,
      })),
    );
    const { svc, asked } = make();
    const res = await svc.forCaller(user(Role.FINANCE));
    expect(res.queues.find((q) => q.key === 'expenses')).toEqual({
      key: 'expenses',
      count: 0,
      oldestAt: null,
      href: '/dashboard/expense-claims',
    });
    expect(asked.map(([q]) => q)).not.toContain('expenses');
  });

  it('opens a queue at the depots where a GRANT gives a scoped role a capability it lacks', async () => {
    loadDepotOverrides([{ capability: 'approvals', roleKey: 'SUPERVISOR', depotId: D2, effect: 'GRANT' }]);
    const { svc, asked, listed } = make();
    const res = await svc.forCaller(user(Role.SUPERVISOR, { depotId: D1, depotIds: [D1, D2] }));
    expect(keys(res)).toEqual(['approvals']);
    expect(asked[0][1].depotIds).toEqual([D2]);
    expect(listed.calls).toBe(0);
  });

  it('leaves the queue out when the GRANT is at a depot outside the scoped role scope', async () => {
    loadDepotOverrides([{ capability: 'approvals', roleKey: 'SUPERVISOR', depotId: D3, effect: 'GRANT' }]);
    const { svc } = make();
    await expect(svc.forCaller(user(Role.SUPERVISOR, { depotId: D1, depotIds: [D1, D2] }))).resolves.toEqual({
      queues: [],
    });
  });

  it('opens a queue at the GRANTed depots for a network-wide role without the capability', async () => {
    loadDepotOverrides([{ capability: 'approvals', roleKey: 'HEAD_OFFICE', depotId: D2, effect: 'GRANT' }]);
    const { svc, asked, listed } = make();
    const res = await svc.forCaller(user(Role.HEAD_OFFICE));
    expect(keys(res)).toEqual(['priceOverrides', 'leave', 'franchiseApplications', 'approvals']);
    expect(asked.find(([q]) => q === 'approvals')![1].depotIds).toEqual([D2]);
    expect(listed.calls).toBe(1);
  });

  it('leaves a queue out when the only override is a DENY on a capability the role lacks', async () => {
    loadDepotOverrides([{ capability: 'approvals', roleKey: 'HEAD_OFFICE', depotId: D2, effect: 'DENY' }]);
    const { svc, listed } = make();
    expect(keys(await svc.forCaller(user(Role.HEAD_OFFICE)))).toEqual([
      'priceOverrides',
      'leave',
      'franchiseApplications',
    ]);
    expect(listed.calls).toBe(0);
  });

  it('counts nothing for a custom role that is archived or unknown, even with a depot GRANT', async () => {
    loadDepotOverrides([{ capability: 'approvals', roleKey: 'C_GHOST', depotId: D2, effect: 'GRANT' }]);
    const { svc, asked, listed } = make();
    await expect(svc.forCaller(user('C_GHOST'))).resolves.toEqual({ queues: [] });
    expect(asked).toEqual([]);
    expect(listed.calls).toBe(0);
  });

  it('opens a queue at the GRANTed depot for a live custom role', async () => {
    loadCustomRoles([{ key: 'C_AUDIT', name: 'Audit', scope: 'GLOBAL' }]);
    loadDepotOverrides([{ capability: 'approvals', roleKey: 'C_AUDIT', depotId: D2, effect: 'GRANT' }]);
    const { svc, asked } = make();
    const res = await svc.forCaller(user('C_AUDIT'));
    expect(keys(res)).toEqual(['approvals']);
    expect(asked[0][1].depotIds).toEqual([D2]);
  });

  it('leaves everything out for a disabled role that still has a depot GRANT', async () => {
    loadRoleSettings([{ roleKey: 'HEAD_OFFICE', disabled: true }]);
    loadDepotOverrides([{ capability: 'approvals', roleKey: 'HEAD_OFFICE', depotId: D2, effect: 'GRANT' }]);
    const { svc, asked } = make();
    await expect(svc.forCaller(user(Role.HEAD_OFFICE))).resolves.toEqual({ queues: [] });
    expect(asked).toEqual([]);
  });

  it.each<[string, string[] | null | 'THROW']>([
    ['answers nothing', null],
    ['fails', 'THROW'],
  ])('says unavailable, never a count, when the depot list %s', async (_label, network) => {
    loadDepotOverrides([
      { capability: 'expenseApprove', roleKey: 'FINANCE', depotId: D2, effect: 'DENY' },
      { capability: 'approvals', roleKey: 'HEAD_OFFICE', depotId: D2, effect: 'GRANT' },
    ]);
    const { svc, asked } = make([], network);
    const res = await svc.forCaller(user(Role.FINANCE));
    expect(res.queues.find((q) => q.key === 'expenses')).toEqual({
      key: 'expenses',
      count: null,
      oldestAt: null,
      href: '/dashboard/expense-claims',
      error: 'unavailable',
    });
    expect(res.queues.find((q) => q.key === 'settlements')).toMatchObject({ count: 3 });
    expect(asked.map(([q]) => q)).not.toContain('expenses');
    const ho = await svc.forCaller(user(Role.HEAD_OFFICE));
    expect(ho.queues.find((q) => q.key === 'approvals')).toMatchObject({ count: null, error: 'unavailable' });
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
