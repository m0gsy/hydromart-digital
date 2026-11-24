import { DashboardConfigService } from '../../src/config/dashboard-config.service';
import {
  PENDING_QUEUE_KEYS,
  PendingQueueKey,
} from '../../src/application/ports/pending-approval-sources.port';
import { PendingApprovalSourcesHttpAdapter } from '../../src/infrastructure/http/pending-approval-sources.http.adapter';

const ACTOR = '99999999-9999-4999-8999-999999999999';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';

const config = (over: Partial<Record<keyof DashboardConfigService, string>> = {}) =>
  ({
    depotServiceUrl: 'http://depot:3007',
    deliveryServiceUrl: 'http://delivery:3006',
    paymentServiceUrl: 'http://payment:3005',
    payoutServiceUrl: 'http://payout:3016',
    hrServiceUrl: 'http://hr:3018',
    internalServiceKey: 'internal-key',
    ...over,
  }) as unknown as DashboardConfigService;

const answer = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('PendingApprovalSourcesHttpAdapter', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(answer({ count: 2, oldestAt: null }));
  });
  afterEach(() => fetchMock.mockRestore());

  const urlOf = (call = 0) => new URL(String(fetchMock.mock.calls[call][0]));

  it.each<[PendingQueueKey, string]>([
    ['priceOverrides', 'http://depot:3007/api/v1/pending-approvals/internal/price-overrides'],
    ['refunds', 'http://payment:3005/api/v1/pending-approvals/internal/refunds'],
    ['expenses', 'http://payout:3016/api/v1/pending-approvals/internal/expenses'],
    ['settlements', 'http://delivery:3006/api/v1/pending-approvals/internal/settlements'],
    ['leave', 'http://hr:3018/api/v1/pending-approvals/internal/leave'],
    ['kasbon', 'http://hr:3018/api/v1/pending-approvals/internal/kasbon'],
    ['franchiseApplications', 'http://depot:3007/api/v1/pending-approvals/internal/franchise-applications'],
    ['approvals', 'http://depot:3007/api/v1/pending-approvals/internal/approvals'],
  ])('asks the service that holds %s, with the internal key', async (queue, path) => {
    const adapter = new PendingApprovalSourcesHttpAdapter(config());
    await expect(adapter.count(queue, { actorId: ACTOR, role: 'MANAGER' })).resolves.toEqual({
      count: 2,
      oldestAt: null,
    });
    const url = urlOf();
    expect(`${url.origin}${url.pathname}`).toBe(path);
    expect(Object.fromEntries(url.searchParams)).toEqual({ actorId: ACTOR, role: 'MANAGER' });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'x-internal-key': 'internal-key',
      accept: 'application/json',
    });
  });

  it('covers every queue', () => {
    expect(PENDING_QUEUE_KEYS).toHaveLength(8);
  });

  it('names the depots, comma-separated, when the count is held to some', async () => {
    await new PendingApprovalSourcesHttpAdapter(config()).count('approvals', {
      actorId: ACTOR,
      role: 'MANAGER',
      depotIds: [D1, D2],
    });
    expect(urlOf().searchParams.get('depotIds')).toBe(`${D1},${D2}`);
  });

  it('splits a long depot list into calls of 100, adds the counts and keeps the earliest oldestAt', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const oldest = ['2026-11-20T00:00:00.000Z', '2026-11-05T00:00:00.000Z', null];
    let n = 0;
    fetchMock.mockImplementation(async () => answer({ count: 10 + n, oldestAt: oldest[n++] }));
    await expect(
      new PendingApprovalSourcesHttpAdapter(config()).count('approvals', { actorId: ACTOR, role: 'MANAGER', depotIds: ids }),
    ).resolves.toEqual({ count: 33, oldestAt: '2026-11-05T00:00:00.000Z' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sent = [0, 1, 2].map((i) => urlOf(i).searchParams.get('depotIds')!.split(','));
    expect(sent.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(sent.flat()).toEqual(ids);
  });

  it('keeps one call for exactly 100 depots, and fails the whole answer when one chunk fails', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const adapter = new PendingApprovalSourcesHttpAdapter(config());
    await adapter.count('approvals', { actorId: ACTOR, role: 'MANAGER', depotIds: ids });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(answer({ count: 1, oldestAt: null })).mockResolvedValueOnce(answer({}, 503));
    await expect(
      adapter.count('approvals', { actorId: ACTOR, role: 'MANAGER', depotIds: [...ids, D1] }),
    ).rejects.toThrow('depot-service answered 503');
  });

  it('answers the oldest time as UTC ISO', async () => {
    fetchMock.mockResolvedValue(answer({ count: 1, oldestAt: '2026-11-20T08:02:03+07:00' }));
    await expect(
      new PendingApprovalSourcesHttpAdapter(config()).count('kasbon', { actorId: ACTOR, role: 'HR' }),
    ).resolves.toEqual({ count: 1, oldestAt: '2026-11-20T01:02:03.000Z' });
  });

  it('refuses to ask a service that is not configured', async () => {
    const adapter = new PendingApprovalSourcesHttpAdapter(config({ hrServiceUrl: '' }));
    await expect(adapter.count('leave', { actorId: ACTOR, role: 'HR' })).rejects.toThrow(
      'hr-service is not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a refusal from the holding service', async () => {
    fetchMock.mockResolvedValue(answer({}, 503));
    await expect(
      new PendingApprovalSourcesHttpAdapter(config()).count('refunds', { actorId: ACTOR, role: 'FINANCE' }),
    ).rejects.toThrow('payment-service answered 503');
  });

  it.each([
    ['no body', null],
    ['no count', { oldestAt: null }],
    ['a negative count', { count: -1, oldestAt: null }],
    ['a fractional count', { count: 1.5, oldestAt: null }],
    ['a count that is text', { count: '3', oldestAt: null }],
    ['an oldest time that is not a time', { count: 1, oldestAt: 'yesterday' }],
    ['an oldest time that is a number', { count: 1, oldestAt: 1732000000000 }],
  ])('rejects an answer with %s', async (_label, body) => {
    fetchMock.mockResolvedValue(answer(body));
    await expect(
      new PendingApprovalSourcesHttpAdapter(config()).count('approvals', { actorId: ACTOR, role: 'MANAGER' }),
    ).rejects.toThrow();
  });
});
