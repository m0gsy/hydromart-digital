import { RecommendationConfigService } from '../../src/config/recommendation-config.service';
import { OrderFeedHttpAdapter } from '../../src/infrastructure/http/order-feed.http.adapter';

// Exercises the REAL HTTP adapter code (config gate, URL/query building, x-internal-key
// header, res.ok branch, fail-open catch, response mapping) against a mocked global.fetch —
// the unit the e2e's Fake* stand-in never runs. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): RecommendationConfigService {
  return {
    orderServiceUrl: 'http://order:3006',
    internalServiceKey: KEY,
    ...over,
  } as unknown as RecommendationConfigService;
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

describe('OrderFeedHttpAdapter', () => {
  it('skips (empty page) when no order-service url', async () => {
    const out = await new OrderFeedHttpAdapter(makeConfig({ orderServiceUrl: '' })).fetchCompleted(null, 50);
    expect(out).toEqual({ orders: [], nextCursor: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips (empty page) when no internal key', async () => {
    const out = await new OrderFeedHttpAdapter(makeConfig({ internalServiceKey: '' })).fetchCompleted(null, 50);
    expect(out).toEqual({ orders: [], nextCursor: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches with limit only (no cursor) and x-internal-key on happy path', async () => {
    fetchMock.mockResolvedValue(res({ body: { orders: [], nextCursor: null } }));
    await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 25);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3006/api/v1/orders/internal/completed?limit=25',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-internal-key': KEY }) }),
    );
  });

  it('appends cursor to the query when provided', async () => {
    fetchMock.mockResolvedValue(res({ body: { orders: [], nextCursor: null } }));
    await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted('cur 1', 10);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3006/api/v1/orders/internal/completed?limit=10&cursor=cur+1',
      expect.any(Object),
    );
  });

  it('maps orders (completedAt wins) and passes through nextCursor', async () => {
    const items = [{ productId: 'p1', quantity: 2 }];
    fetchMock.mockResolvedValue(
      res({
        body: {
          orders: [
            { id: 'o1', customerId: 'c1', depotId: 'd1', completedAt: '2026-01-02T03:04:05.000Z', updatedAt: '2020-01-01T00:00:00.000Z', items },
          ],
          nextCursor: 'next',
        },
      }),
    );
    const out = await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 50);
    expect(out.nextCursor).toBe('next');
    expect(out.orders).toHaveLength(1);
    expect(out.orders[0]).toMatchObject({ orderId: 'o1', customerId: 'c1', depotId: 'd1', items });
    expect(out.orders[0].at.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('falls back to updatedAt when completedAt is absent, and null depotId', async () => {
    fetchMock.mockResolvedValue(
      res({
        body: {
          orders: [{ id: 'o2', customerId: 'c2', updatedAt: '2025-06-07T08:09:10.000Z', items: [] }],
          nextCursor: null,
        },
      }),
    );
    const out = await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 50);
    expect(out.orders[0].depotId).toBeNull();
    expect(out.orders[0].at.toISOString()).toBe('2025-06-07T08:09:10.000Z');
  });

  it('falls back to now when neither completedAt nor updatedAt present', async () => {
    const before = Date.now();
    fetchMock.mockResolvedValue(
      res({ body: { orders: [{ id: 'o3', customerId: 'c3', items: [] }], nextCursor: null } }),
    );
    const out = await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 50);
    expect(out.orders[0].at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('fails open (empty page) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    const out = await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 50);
    expect(out).toEqual({ orders: [], nextCursor: null });
  });

  it('fails open (empty page) when order-service is unreachable / aborts', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 50);
    expect(out).toEqual({ orders: [], nextCursor: null });
  });

  it('fails open (empty page) when the body cannot be parsed', async () => {
    fetchMock.mockResolvedValue(res({ throwJson: true }));
    const out = await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 50);
    expect(out).toEqual({ orders: [], nextCursor: null });
  });
});
