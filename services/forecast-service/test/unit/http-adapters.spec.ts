import { ServiceUnavailableException } from '@nestjs/common';

import { ForecastConfigService } from '../../src/config/forecast-config.service';
import { OrderFeedHttpAdapter } from '../../src/infrastructure/http/order-feed.http.adapter';
import { DepotOwnershipHttpAdapter } from '../../src/infrastructure/http/depot-ownership.http.adapter';

// Exercises the REAL forecast HTTP adapter code (URL building, x-internal-key header,
// res.ok branches, fail-open/fail-closed catch, response parsing) against a mocked
// global.fetch. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): ForecastConfigService {
  return {
    orderServiceUrl: 'http://order:3005',
    depotServiceUrl: 'http://depot:3007',
    internalServiceKey: KEY,
    ...over,
  } as unknown as ForecastConfigService;
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
  const page = {
    orders: [
      {
        id: 'o1',
        customerId: 'c1',
        depotId: 'd1',
        total: 57000,
        completedAt: '2026-01-02T00:00:00.000Z',
        items: [{ productId: 'p1', quantity: 2 }],
      },
      {
        // no depotId/total/completedAt — exercises the ?? fallbacks
        id: 'o2',
        customerId: 'c2',
        updatedAt: '2026-01-03T00:00:00.000Z',
        items: [{ productId: 'p2', quantity: 1 }],
      },
    ],
    nextCursor: 'cur-2',
  };

  it('skips (empty page) when no base URL', async () => {
    const out = await new OrderFeedHttpAdapter(makeConfig({ orderServiceUrl: '' })).fetchCompleted(null, 50);
    expect(out).toEqual({ orders: [], nextCursor: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips (empty page) when no internal key', async () => {
    const out = await new OrderFeedHttpAdapter(makeConfig({ internalServiceKey: '' })).fetchCompleted(null, 50);
    expect(out).toEqual({ orders: [], nextCursor: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the completed-orders page on happy path (with cursor + key header)', async () => {
    fetchMock.mockResolvedValue(res({ body: page }));
    const out = await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted('cur-1', 25);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3005/api/v1/orders/internal/completed?limit=25&cursor=cur-1',
      expect.objectContaining({ headers: { 'x-internal-key': KEY } }),
    );
    expect(out.nextCursor).toBe('cur-2');
    expect(out.orders).toHaveLength(2);
    expect(out.orders[0]).toMatchObject({ orderId: 'o1', depotId: 'd1', total: 57000 });
    expect(out.orders[0].at).toEqual(new Date('2026-01-02T00:00:00.000Z'));
    // second order falls back: null depot, 0 total, updatedAt used for `at`
    expect(out.orders[1]).toMatchObject({ orderId: 'o2', depotId: null, total: 0 });
    expect(out.orders[1].at).toEqual(new Date('2026-01-03T00:00:00.000Z'));
  });

  it('omits the cursor param when cursor is null', async () => {
    fetchMock.mockResolvedValue(res({ body: { orders: [], nextCursor: null } }));
    await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 10);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3005/api/v1/orders/internal/completed?limit=10',
      expect.anything(),
    );
  });

  it('fails open (empty page) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    const out = await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 50);
    expect(out).toEqual({ orders: [], nextCursor: null });
  });

  it('fails open (empty page) on network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await new OrderFeedHttpAdapter(makeConfig()).fetchCompleted(null, 50);
    expect(out).toEqual({ orders: [], nextCursor: null });
  });
});

describe('DepotOwnershipHttpAdapter', () => {
  it('fails closed (throws) when no base URL', async () => {
    await expect(
      new DepotOwnershipHttpAdapter(makeConfig({ depotServiceUrl: '' })).ownedDepotIds('owner-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed (throws) when no internal key', async () => {
    await expect(
      new DepotOwnershipHttpAdapter(makeConfig({ internalServiceKey: '' })).ownedDepotIds('owner-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns filtered depot ids on happy path (with key header)', async () => {
    fetchMock.mockResolvedValue(res({ body: { depotIds: ['d1', 'd2', 42, null, 'd3'] } }));
    const out = await new DepotOwnershipHttpAdapter(makeConfig()).ownedDepotIds('owner-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://depot:3007/api/v1/depots/internal/owned/owner-1',
      expect.objectContaining({ headers: { 'x-internal-key': KEY } }),
    );
    expect(out).toEqual(['d1', 'd2', 'd3']);
  });

  it('returns [] when depotIds is missing/not an array', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    expect(await new DepotOwnershipHttpAdapter(makeConfig()).ownedDepotIds('owner-1')).toEqual([]);
  });

  it('fails closed (throws) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new DepotOwnershipHttpAdapter(makeConfig()).ownedDepotIds('owner-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed (throws) on network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new DepotOwnershipHttpAdapter(makeConfig()).ownedDepotIds('owner-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
