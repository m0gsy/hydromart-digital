import { DepotConfigService } from '../../src/config/depot-config.service';
import { LowStockAlert } from '../../src/application/ports/low-stock-alert.port';
import { LowStockAlertHttpAdapter } from '../../src/infrastructure/http/low-stock-alert.http.adapter';
import { UntrackedSaleAlert } from '../../src/application/ports/untracked-sale-alert.port';
import { UntrackedSaleAlertHttpAdapter } from '../../src/infrastructure/http/untracked-sale-alert.http.adapter';
import { ProductCatalogHttpAdapter } from '../../src/infrastructure/http/product-catalog.http.adapter';
import { OrderSubscriptionHttpAdapter } from '../../src/infrastructure/http/order-subscription.http.adapter';

// Exercises the REAL HTTP adapter code (skip branches, URL/header/body building, res.ok
// branch, fail-open catch) against a mocked global.fetch — the unit the e2e's Fake* stand-in
// never runs. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): DepotConfigService {
  return {
    crmServiceUrl: 'http://crm:3012',
    productServiceUrl: 'http://products:3003',
    alertPhone: '628123456789',
    internalServiceKey: KEY,
    ...over,
  } as unknown as DepotConfigService;
}

function jsonRes(status: number, body: unknown = {}): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

function res(init: { ok?: boolean; status?: number }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return { ok: init.ok ?? status < 400, status } as unknown as Response;
}

const alert = (): LowStockAlert => ({
  depotId: 'd1',
  depotName: 'Depot Pusat',
  label: 'Galon 19L',
  quantity: 3,
  minimum: 10,
});

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('LowStockAlertHttpAdapter', () => {
  it('skips (fail open) when alert phone is blank', async () => {
    await new LowStockAlertHttpAdapter(makeConfig({ alertPhone: '' })).emit(alert(), '');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips (fail open) when crm-service url is blank', async () => {
    await new LowStockAlertHttpAdapter(makeConfig({ crmServiceUrl: '' })).emit(alert(), '');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips (fail open) when no internal key', async () => {
    await new LowStockAlertHttpAdapter(makeConfig({ internalServiceKey: '' })).emit(alert(), '');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts STOCK_LOW to crm internal notifications with x-internal-key on happy path', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new LowStockAlertHttpAdapter(makeConfig()).emit(alert(), 'Bearer x');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://crm:3012/api/v1/notifications/internal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-key': KEY }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({
      event: 'STOCK_LOW',
      phone: '628123456789',
      vars: { depot: 'Depot Pusat', item: 'Galon 19L', quantity: '3', minimum: '10' },
    });
  });

  it('fails open (resolves) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new LowStockAlertHttpAdapter(makeConfig()).emit(alert(), ''),
    ).resolves.toBeUndefined();
  });

  it('fails open (resolves) when crm-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new LowStockAlertHttpAdapter(makeConfig()).emit(alert(), ''),
    ).resolves.toBeUndefined();
  });
});

describe('UntrackedSaleAlertHttpAdapter', () => {
  const sale = (): UntrackedSaleAlert => ({
    depotId: 'd1',
    depotName: 'Depot Pusat',
    orderId: 'o-9',
    productIds: ['p1', 'p2'],
    stage: 'COMPLETION',
  });

  it.each([['alertPhone'], ['crmServiceUrl'], ['internalServiceKey']])(
    'skips (fail open) when %s is blank',
    async (key) => {
      await new UntrackedSaleAlertHttpAdapter(makeConfig({ [key]: '' })).emit(sale(), '');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('posts STOCK_UNTRACKED with the number of untracked products', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new UntrackedSaleAlertHttpAdapter(makeConfig()).emit(sale(), 'Bearer x');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toMatchObject({
      event: 'STOCK_UNTRACKED',
      phone: '628123456789',
      vars: { depot: 'Depot Pusat', order: 'o-9', count: '2' },
    });
  });

  // The sale is already recorded by the time this runs; a failed warning must not surface
  // as a failed order.
  it.each([
    ['non-2xx', () => fetchMock.mockResolvedValue(res({ ok: false, status: 500 }))],
    ['an unreachable crm-service', () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))],
  ])('fails open (resolves) on %s', async (_label, arrange) => {
    arrange();
    await expect(
      new UntrackedSaleAlertHttpAdapter(makeConfig()).emit(sale(), ''),
    ).resolves.toBeUndefined();
  });
});

describe('ProductCatalogHttpAdapter', () => {
  const product = {
    id: 'p1',
    name: 'Air Galon 19L',
    sku: 'AIR-19L',
    unit: 'Galon',
    active: true,
  };

  it('maps a found product', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, product));
    await expect(new ProductCatalogHttpAdapter(makeConfig()).find('p1')).resolves.toEqual({
      status: 'found',
      product,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://products:3003/api/v1/products/p1',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  // 404 covers "no such product" AND "deactivated" — the endpoint is active-only, and
  // both are reasons to refuse opening a stock line.
  it('reports a 404 as missing, not as an outage', async () => {
    fetchMock.mockResolvedValue(jsonRes(404));
    await expect(new ProductCatalogHttpAdapter(makeConfig()).find('gone')).resolves.toEqual({
      status: 'missing',
    });
  });

  // 'unavailable' is what lets the caller accept the line anyway: a catalog outage must
  // not stop a depot registering its stock.
  it.each([
    ['a 5xx', () => fetchMock.mockResolvedValue(jsonRes(503))],
    ['an unreachable product-service', () => fetchMock.mockRejectedValue(new Error('ETIMEDOUT'))],
  ])('reports %s as unavailable', async (_label, arrange) => {
    arrange();
    await expect(new ProductCatalogHttpAdapter(makeConfig()).find('p1')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('resolves a product by exact sku, ignoring a search hit that merely contains it', async () => {
    fetchMock.mockResolvedValue(
      jsonRes(200, { items: [{ ...product, id: 'p2', sku: 'AIR-19L-XL' }, product] }),
    );
    await expect(new ProductCatalogHttpAdapter(makeConfig()).findBySku('AIR-19L')).resolves.toEqual({
      status: 'found',
      product,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://products:3003/api/v1/products?search=AIR-19L&limit=20',
    );
  });

  it('reports a sku no product carries as missing', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { items: [] }));
    await expect(
      new ProductCatalogHttpAdapter(makeConfig()).findBySku('TIDAK-ADA'),
    ).resolves.toEqual({ status: 'missing' });
  });

  it('reports unavailable without calling out when no product-service url is set', async () => {
    await expect(
      new ProductCatalogHttpAdapter(makeConfig({ productServiceUrl: '' })).find('p1'),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Every adapter arms a timer that aborts its own request. Without letting it fire, a
// dependency that accepts the connection and then hangs would keep a stock movement or a
// line creation waiting forever instead of failing open.
describe('an outbound call that hangs is aborted and still settles', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const aborted = new Error('The operation was aborted');
            aborted.name = 'AbortError';
            reject(aborted);
          });
        }),
    );
  });
  afterEach(() => jest.useRealTimers());

  const cases: [string, () => Promise<unknown>][] = [
    ['low-stock.emit', () => new LowStockAlertHttpAdapter(makeConfig()).emit(alert(), '')],
    [
      'untracked-sale.emit',
      () =>
        new UntrackedSaleAlertHttpAdapter(makeConfig()).emit(
          { depotId: 'd1', depotName: 'D', orderId: 'o1', productIds: ['p1'], stage: 'CHECKOUT' },
          '',
        ),
    ],
    ['product-catalog.find', () => new ProductCatalogHttpAdapter(makeConfig()).find('p1')],
    ['product-catalog.findBySku', () => new ProductCatalogHttpAdapter(makeConfig()).findBySku('X')],
  ];

  it.each(cases)('%s', async (_name, run) => {
    // The handler has to be attached before the timer fires, or the rejection lands unhandled.
    const settled = run().then(
      () => 'settled',
      () => 'settled',
    );
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await settled).toBe('settled');
    expect(fetchMock).toHaveBeenCalled();
  });
});

/**
 * D10 · the depot's plans run on order-service's engine, not on a second one grown here.
 *
 * This adapter is the one in this file that must NOT fail open. A depot row saved without
 * its engine subscription is exactly the thing D10 removes — a plan the console shows and
 * nothing runs — so a failure has to reach the operator while they are still on the screen.
 */
describe('OrderSubscriptionHttpAdapter', () => {
  const input = {
    customerId: 'c1',
    productId: 'p1',
    quantity: 2,
    frequency: 'WEEKLY' as const,
    firstDeliveryAt: new Date('2026-09-01T00:00:00Z'),
  };
  const cfg = (over: Partial<Record<string, unknown>> = {}) =>
    makeConfig({ orderServiceUrl: 'http://order:3004', ...over });

  it('creates the engine subscription and hands back its id', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(200, { id: 'eng-9' }));
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    await expect(new OrderSubscriptionHttpAdapter(cfg()).create(input)).resolves.toBe('eng-9');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('http://order:3004/api/v1/subscriptions/internal');
    expect(init.headers['x-internal-key']).toBe(KEY);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      customerId: 'c1',
      productId: 'p1',
      quantity: 2,
      frequency: 'WEEKLY',
      firstDeliveryAt: '2026-09-01T00:00:00.000Z',
    });
    // No address travels: the engine reads the customer's own, which is what stops an
    // operator from typing one on somebody else's behalf.
    expect('address' in body).toBe(false);
  });

  // The engine knows WHY far better than this layer does. "This customer has no saved
  // address" is something an operator can act on; flattening it to "failed" wastes it.
  it('carries the engine own refusal through, word for word', async () => {
    (globalThis as { fetch: unknown }).fetch = jest
      .fn()
      .mockResolvedValue(jsonRes(422, { message: 'Pelanggan ini belum punya alamat tersimpan' }));

    await expect(new OrderSubscriptionHttpAdapter(cfg()).create(input)).rejects.toThrow(
      /belum punya alamat tersimpan/,
    );
  });

  it('throws on a 2xx that carries no id, rather than inventing a link', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue(jsonRes(200, {}));
    await expect(new OrderSubscriptionHttpAdapter(cfg()).create(input)).rejects.toThrow(
      /order-service responded 200|Langganan tidak bisa dibuat/,
    );
  });

  // A deployment with no engine configured must refuse loudly too. Saving a depot row here
  // would recreate the exact bug: a plan on screen that nothing will ever run.
  it('refuses when the engine is not configured, and calls nothing', async () => {
    const fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    await expect(
      new OrderSubscriptionHttpAdapter(cfg({ orderServiceUrl: '' })).create(input),
    ).rejects.toThrow(/belum dikonfigurasi/);
    await expect(
      new OrderSubscriptionHttpAdapter(cfg({ internalServiceKey: '' })).create(input),
    ).rejects.toThrow(/belum dikonfigurasi/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
