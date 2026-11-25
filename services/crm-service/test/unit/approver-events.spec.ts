import { loadDepotOverrides } from '@hydromart/access';

import { NotificationService } from '../../src/application/services/notification.service';
import { PushService } from '../../src/application/services/push.service';
import { ApproverDirectoryPort } from '../../src/application/ports/approver-directory.port';
import { PushPayload } from '../../src/application/ports/push-sender.port';
import { destinationFor } from '../../src/domain/notification-destination';
import { NotificationEvent, templateFor } from '../../src/domain/notification-event';
import { ApproverDirectoryHttpAdapter } from '../../src/infrastructure/http/approver-directory.http.adapter';
import { CrmConfigService } from '../../src/config/crm-config.service';
import { InMemoryNotificationRepository } from '../support/fakes';

/*
 * Flow 6b (plan PR-6, owner: "masing-masing ke penyetujunya"): a decision event wakes the
 * accounts that may make it — the depot's own staff and overseers holding the capability, and
 * the network roles holding it — never the whole depot roster.
 */

const ROLES: Record<string, string> = {
  'kd-1': 'KEPALA_DEPOT',
  'op-1': 'STAFF_DEPOT',
  'cr-1': 'STAFF_DEPOT',
  'mg-1': 'MANAGER',
  'fi-1': 'FINANCE',
  'ho-1': 'HEAD_OFFICE',
  'sa-1': 'SUPER_ADMIN',
};

function build(directory?: Partial<ApproverDirectoryPort>) {
  const pushed: { id: string; payload: PushPayload }[] = [];
  const push = {
    sendToCustomer: async (id: string, payload: PushPayload) => {
      pushed.push({ id, payload });
      return { devices: 1, delivered: 1 };
    },
  } as unknown as PushService;
  const byRoles = jest.fn(async (roles: readonly string[]) =>
    Object.entries(ROLES)
      .filter(([, r]) => roles.includes(r))
      .map(([id]) => id),
  );
  const approvers: ApproverDirectoryPort = {
    staffIdsByRoles: byRoles,
    rolesOf: async (ids) => new Map(ids.filter((i) => ROLES[i]).map((i) => [i, ROLES[i]!])),
    profileOf: async () => null,
    ...directory,
  };
  const repo = new InMemoryNotificationRepository();
  const service = new NotificationService(
    repo,
    push,
    undefined,
    { staffIdsForDepot: async () => ['kd-1', 'op-1', 'cr-1'] },
    undefined,
    { overseersOfDepot: async () => ['mg-1'] },
    undefined,
    approvers,
  );
  return { service, pushed, repo, byRoles };
}

const settle = (service: NotificationService, depotId: string | null = 'dep-1') =>
  service.notify(
    NotificationEvent.COURIER_SETTLEMENT_SUBMITTED,
    '+62800',
    { amount: 'Rp 150.000', variance: '-Rp 5.000', settlementId: 'st-1' },
    null,
    depotId,
  );
const drain = () => new Promise((r) => setImmediate(r));

afterEach(() => loadDepotOverrides([]));

describe('a decision event goes to the accounts that may decide it', () => {
  it('wakes courierSettle holders at the depot, above it and network-wide; not operators or couriers', async () => {
    const { service, pushed, byRoles } = build();
    await settle(service);
    await drain();
    expect(pushed.map((p) => p.id).sort()).toEqual(['fi-1', 'kd-1', 'mg-1']);
    // Only the network-wide roles are looked up by role, and not the superuser: it holds every
    // capability and owns no queue. Depot roles come from the roster.
    expect([...(byRoles.mock.calls[0]![0] as string[])].sort()).toEqual(['FINANCE']);
    expect(pushed[0]!.payload.url).toBe('/dashboard/settlements?id=st-1&depot=dep-1');
  });

  it('honours a per-depot DENY, as the route would', async () => {
    loadDepotOverrides([{ capability: 'courierSettle', roleKey: 'KEPALA_DEPOT', depotId: 'dep-1', effect: 'DENY' }]);
    const { service, pushed } = build();
    await settle(service);
    await drain();
    expect(pushed.map((p) => p.id)).not.toContain('kd-1');
  });

  it('reaches head office for a price change, which no depot role decides', async () => {
    const { service, pushed } = build();
    await service.notify(
      NotificationEvent.PRICE_OVERRIDE_PROPOSED,
      '+62800',
      { depot: 'Depot A', count: '2', product: 'Galon, …' },
      null,
      'dep-1',
    );
    await drain();
    expect(pushed.map((p) => p.id).sort()).toEqual(['ho-1']);
    expect(pushed[0]!.payload.url).toBe('/hq/pricing');
  });

  // Flow 6b-2: a courier's expense claim (expenseApprove) and a refund in the HQ queue (refundQueue).
  it('sends an expense claim to the manager above the depot and finance, not the depot head', async () => {
    const { service, pushed } = build();
    await service.notify(
      NotificationEvent.EXPENSE_CLAIM_SUBMITTED,
      '+62800',
      { claimId: 'cl-1', amount: 'Rp 90.000', category: 'FUEL' },
      null,
      'dep-1',
    );
    await drain();
    expect(pushed.map((p) => p.id).sort()).toEqual(['fi-1', 'mg-1']);
    expect(pushed[0]!.payload.url).toBe('/dashboard/expense-claims?id=cl-1&depot=dep-1');
  });

  it('sends a refund waiting in the HQ queue to finance', async () => {
    const { service, pushed } = build();
    await service.notify(NotificationEvent.REFUND_REQUESTED, '+62800', { paymentId: 'p-1', amount: 'Rp 150.000' });
    await drain();
    expect(pushed.map((p) => p.id)).toEqual(['fi-1']);
    expect(pushed[0]!.payload.url).toBe('/hq/refunds');
  });

  it('works for a decision with no depot, and when the overseers cannot be read', async () => {
    const pushed: string[] = [];
    const service = new NotificationService(
      new InMemoryNotificationRepository(),
      { sendToCustomer: async (id: string) => void pushed.push(id) } as unknown as PushService,
      undefined,
      undefined,
      undefined,
      {
        overseersOfDepot: async () => {
          throw new Error('depot down');
        },
      },
      undefined,
      {
        staffIdsByRoles: async () => ['ho-1'],
        rolesOf: async (ids) => new Map(ids.map((i) => [i, ROLES[i] ?? 'STAFF_DEPOT'])),
        profileOf: async () => null,
      },
    );
    await service.notify(NotificationEvent.PRICE_OVERRIDE_PROPOSED, '+62800', { depot: 'A', count: '1', product: 'G' });
    await service.notify(NotificationEvent.COURIER_SETTLEMENT_SUBMITTED, '+62800', {}, null, 'dep-1');
    await drain();
    expect(pushed.sort()).toEqual(['ho-1']);
  });

  it('wakes nobody without a directory, and pushes nothing for a depot alert with no roster', async () => {
    const pushed: string[] = [];
    const push = { sendToCustomer: async (id: string) => void pushed.push(id) } as unknown as PushService;
    const service = new NotificationService(new InMemoryNotificationRepository(), push);
    await settle(service);
    await service.notify(NotificationEvent.STOCK_LOW, '+62800', {}, null, 'dep-1');
    await drain();
    expect(pushed).toEqual([]);
  });

  // Review: the depot feed is read by everyone at the depot; a decision's row is for those who
  // may make it (a courier's shortfall is not the other couriers' business).
  it('shows a decision row only to readers holding its capability', async () => {
    const { service } = build();
    await settle(service);
    await service.notify(NotificationEvent.STOCK_LOW, '+62800', {}, null, 'dep-1');
    const events = async (role?: string) =>
      (await service.listOpsFeed('x', ['dep-1'], 50, role)).map((r) => r.event).sort();
    expect(await events('STAFF_DEPOT')).toEqual(['STOCK_LOW']);
    expect(await events('KEPALA_DEPOT')).toEqual(['COURIER_SETTLEMENT_SUBMITTED', 'STOCK_LOW']);
    expect(await events()).toEqual(['COURIER_SETTLEMENT_SUBMITTED', 'STOCK_LOW']);
    expect(await service.markAllOpsRead('x', ['dep-1'], 50, 'STAFF_DEPOT')).toBe(1);
  });

  it('keeps the row in the feed and wakes nobody when the directory cannot be read', async () => {
    const { service, pushed, repo } = build({
      staffIdsByRoles: async () => {
        throw new Error('auth down');
      },
    });
    await settle(service);
    await drain();
    expect(pushed).toEqual([]);
    expect(repo.records[0]).toMatchObject({ event: 'COURIER_SETTLEMENT_SUBMITTED', depotId: 'dep-1' });
  });

  it('has copy in both languages and a screen to open', () => {
    expect(templateFor(NotificationEvent.COURIER_SETTLEMENT_SUBMITTED, 'id')).toMatch(/Setoran/);
    expect(templateFor(NotificationEvent.PRICE_OVERRIDE_PROPOSED, 'en')).toMatch(/Pricing/);
    expect(destinationFor(NotificationEvent.COURIER_SETTLEMENT_SUBMITTED, {})).toBe('/dashboard/settlements');
  });
});

describe('ApproverDirectoryHttpAdapter', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const config = { authServiceUrl: 'http://auth', internalServiceKey: 'k' } as unknown as CrmConfigService;

  it('asks auth for role holders and resolves roles 200 ids at a time', async () => {
    const calls: { url: string; body: unknown }[] = [];
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      if (url.endsWith('staff/by-roles')) return { ok: true, json: async () => ({ ids: ['a', 7, 'b'] }) };
      return { ok: true, json: async () => body.ids.map((id: string) => ({ id, role: 'FINANCE' })) };
    }) as never;
    const adapter = new ApproverDirectoryHttpAdapter(config);
    expect(await adapter.staffIdsByRoles(['FINANCE'])).toEqual(['a', 'b']);
    expect(await adapter.staffIdsByRoles([])).toEqual([]);
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const roles = await adapter.rolesOf(ids);
    expect(roles.size).toBe(250);
    expect(calls.filter((c) => c.url.endsWith('customers/by-ids')).map((c) => (c.body as { ids: string[] }).ids.length)).toEqual([200, 50]);
    expect(calls[0]!.url).toBe('http://auth/api/v1/auth/internal/staff/by-roles');
  });

  it('reads past junk in an answer instead of trusting its shape', async () => {
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.endsWith('staff/by-roles') ? { ids: 'nope' } : [null, { id: 1, role: 'X' }, { id: 'a', role: 'FINANCE' }]),
    })) as never;
    const adapter = new ApproverDirectoryHttpAdapter(config);
    expect(await adapter.staffIdsByRoles(['FINANCE'])).toEqual([]);
    expect([...(await adapter.rolesOf(['a', 'b']))]).toEqual([['a', 'FINANCE']]);
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ not: 'a list' }) })) as never;
    expect((await new ApproverDirectoryHttpAdapter(config).rolesOf(['a'])).size).toBe(0);
  });

  it('throws when it cannot ask, so the caller can say so', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 })) as never;
    await expect(new ApproverDirectoryHttpAdapter(config).staffIdsByRoles(['FINANCE'])).rejects.toThrow(/503/);
    await expect(
      new ApproverDirectoryHttpAdapter({ authServiceUrl: '', internalServiceKey: '' } as never).rolesOf(['x']),
    ).rejects.toThrow(/missing/);
  });
});
