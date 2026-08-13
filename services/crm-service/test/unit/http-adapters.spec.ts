import { CrmConfigService } from '../../src/config/crm-config.service';
import { SegmentUnavailableError } from '../../src/domain/errors';
import { CustomerDirectoryHttpAdapter } from '../../src/infrastructure/http/customer-directory.http.adapter';
import { ActivitySegmentHttpAdapter } from '../../src/infrastructure/http/activity-segment.http.adapter';

// Exercises the REAL HTTP adapter code (URL building, query-string segment, authorization
// header, res.ok branch, fail-CLOSED catch, response parsing) against a mocked global.fetch —
// the unit the e2e's Fake* stand-ins never run. No network, no DB.

function makeConfig(over: Partial<Record<string, unknown>> = {}): CrmConfigService {
  return {
    customerServiceUrl: 'http://customer:3002',
    ...over,
  } as unknown as CrmConfigService;
}

function res(init: { ok?: boolean; status?: number; body?: unknown; throwJson?: boolean }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => {
      if (init.throwJson) throw new Error('bad json');
      return init.body ?? {};
    },
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const AUTH = 'Bearer staff-token';

describe('CustomerDirectoryHttpAdapter', () => {
  it('fails closed when customer-service url is not configured', async () => {
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig({ customerServiceUrl: '' })).resolveSegment({}, AUTH),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the caller token is missing', async () => {
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, ''),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the audience (no filter -> no query string) forwarding the bearer token', async () => {
    const recipients = [{ customerId: 'c1', name: 'Ani', phone: '0811' }];
    fetchMock.mockResolvedValue(res({ body: recipients }));
    const out = await new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, AUTH);
    expect(out).toEqual(recipients);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/profile/directory',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: AUTH }) }),
    );
  });

  it('builds the tier + city segment query string', async () => {
    fetchMock.mockResolvedValue(res({ body: [] }));
    await new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment(
      { tier: 'GOLD', city: 'Jakarta Selatan' },
      AUTH,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/profile/directory?tier=GOLD&city=Jakarta+Selatan',
      expect.anything(),
    );
  });

  it('fails closed on non-2xx (never sends to a silently-empty audience)', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, AUTH),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });

  it('fails closed when customer-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig()).resolveSegment({}, AUTH),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });
});

/*
 * The service-auth twin. A depot manager holds `depotCampaign`, not the head-office right
 * to page the customer directory, so their token cannot be the one that opens it — the
 * internal key is. Same query, same fail-closed branches, different door.
 */
describe('CustomerDirectoryHttpAdapter as a service', () => {
  it('fails closed when the internal key is not configured', async () => {
    await expect(
      new CustomerDirectoryHttpAdapter(makeConfig({ internalServiceKey: '' })).resolveSegmentAsService({}),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the internal route under the internal key, with the same filter', async () => {
    const recipients = [{ customerId: 'c1', name: 'Ani', phone: '0811' }];
    fetchMock.mockResolvedValue(res({ body: recipients }));
    const out = await new CustomerDirectoryHttpAdapter(
      makeConfig({ internalServiceKey: 'k' }),
    ).resolveSegmentAsService({ tier: 'GOLD' });
    expect(out).toEqual(recipients);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://customer:3002/api/v1/profile/internal/directory?tier=GOLD');
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe('k');
  });
});

/*
 * The activity half of a segment. Every branch here is a fail-CLOSED one on purpose: a
 * campaign whose audience could not be resolved must be refused, because the alternative
 * — carrying on with whatever the directory returned — sends to a WIDER audience than the
 * one the screen sized. `truncated` is the subtle one: the response is a valid 200 with a
 * real list, and taking it at face value under-sends while reporting success.
 */
describe('ActivitySegmentHttpAdapter', () => {
  const activityConfig = (over: Partial<Record<string, unknown>> = {}): CrmConfigService =>
    ({ orderServiceUrl: 'http://order:3003', internalServiceKey: 'k', ...over }) as unknown as CrmConfigService;

  it.each([
    ['order-service url is not configured', { orderServiceUrl: '' }],
    ['the internal key is not configured', { internalServiceKey: '' }],
  ])('fails closed when %s', async (_case, over) => {
    await expect(
      new ActivitySegmentHttpAdapter(activityConfig(over)).customersIn({ lapsedDays: 60 }),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends every condition as a query param under the internal key', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerIds: ['c1', 'c2'], truncated: false } }));
    const out = await new ActivitySegmentHttpAdapter(activityConfig()).customersIn({
      lapsedDays: 60,
      depotId: 'depot-1',
    });
    expect(out).toEqual(['c1', 'c2']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/reports/internal/segment-customers?');
    expect(url).toContain('lapsedDays=60');
    expect(url).toContain('depotId=depot-1');
    expect((init as { headers: Record<string, string> }).headers['x-internal-key']).toBe('k');
  });

  it('refuses a truncated segment instead of broadcasting to part of it', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerIds: ['c1'], truncated: true } }));
    await expect(
      new ActivitySegmentHttpAdapter(activityConfig()).customersIn({ minOrders: 1 }),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });

  it.each([
    ['a non-2xx answer', () => fetchMock.mockResolvedValue(res({ ok: false, status: 503 }))],
    ['a network error', () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))],
  ])('fails closed on %s', async (_case, arrange) => {
    arrange();
    await expect(
      new ActivitySegmentHttpAdapter(activityConfig()).customersIn({ minOrders: 1 }),
    ).rejects.toBeInstanceOf(SegmentUnavailableError);
  });
});
