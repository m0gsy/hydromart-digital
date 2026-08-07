import { CustomerConfigService } from '../../src/config/customer-config.service';
import { LoyaltyRewardHttpAdapter } from '../../src/infrastructure/http/loyalty-reward.http.adapter';
import { OrderCrmHttpAdapter } from '../../src/infrastructure/http/order-crm.http.adapter';
import { ProductCatalogHttpAdapter } from '../../src/infrastructure/http/product-catalog.http.adapter';
import { IdentityHttpAdapter } from '../../src/infrastructure/http/identity.http.adapter';

// Exercises the REAL HTTP adapter code (URL building, x-internal-key header, config
// guards, res.ok branch) against a mocked global.fetch. Unlike the fail-open adapters
// elsewhere, LoyaltyRewardHttpAdapter THROWS on any failure so the birthday sweep
// retries the un-stamped customer next run. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): CustomerConfigService {
  return {
    loyaltyServiceUrl: 'http://loyalty:3009',
    internalServiceKey: KEY,
    ...over,
  } as unknown as CustomerConfigService;
}

function res(init: { ok?: boolean; status?: number; json?: unknown }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => init.json ?? {},
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('LoyaltyRewardHttpAdapter', () => {
  it('throws when loyalty-service url is not configured (no fetch)', async () => {
    await expect(
      new LoyaltyRewardHttpAdapter(makeConfig({ loyaltyServiceUrl: '' })).reward('c1', 50, 'birthday', ''),
    ).rejects.toThrow('LOYALTY_SERVICE_URL not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when internal key is not configured (no fetch)', async () => {
    await expect(
      new LoyaltyRewardHttpAdapter(makeConfig({ internalServiceKey: '' })).reward('c1', 50, 'birthday', ''),
    ).rejects.toThrow('INTERNAL_SERVICE_KEY not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to loyalty/reward with x-internal-key on happy path', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new LoyaltyRewardHttpAdapter(makeConfig()).reward('c1', 50, 'birthday', '');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://loyalty:3009/api/v1/loyalty/reward',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-key': KEY }),
        body: JSON.stringify({ customerId: 'c1', points: 50, reason: 'birthday' }),
      }),
    );
  });

  it('throws (does NOT fail open) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new LoyaltyRewardHttpAdapter(makeConfig()).reward('c1', 50, 'birthday', ''),
    ).rejects.toThrow('loyalty-service responded 503');
  });

  it('propagates fetch rejection when loyalty is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new LoyaltyRewardHttpAdapter(makeConfig()).reward('c1', 50, 'birthday', ''),
    ).rejects.toThrow('ECONNREFUSED');
  });
});

describe('OrderCrmHttpAdapter (fail-soft → [])', () => {
  const cfg = (over: Partial<Record<string, unknown>> = {}) =>
    ({ orderServiceUrl: 'http://order:3004/', internalServiceKey: KEY, ...over }) as unknown as CustomerConfigService;

  it('returns [] without fetching when url or key is missing', async () => {
    expect(await new OrderCrmHttpAdapter(cfg({ orderServiceUrl: '' })).depotCustomerStats('d1')).toEqual([]);
    expect(await new OrderCrmHttpAdapter(cfg({ internalServiceKey: '' })).depotCustomerStats('d1')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps customers and parses dates on happy path (trailing slash trimmed, x-internal-key sent)', async () => {
    fetchMock.mockResolvedValue(
      res({
        ok: true,
        json: {
          customers: [
            { customerId: 'c1', name: 'A', phone: '1', orderCount: 3, totalSpent: 90, firstOrderAt: '2026-01-01T00:00:00.000Z', lastOrderAt: '2026-06-01T00:00:00.000Z' },
            { customerId: 'c2', name: null, phone: null, orderCount: 1, totalSpent: 10, firstOrderAt: null, lastOrderAt: null },
          ],
        },
      }),
    );
    const out = await new OrderCrmHttpAdapter(cfg()).depotCustomerStats('d1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3004/api/v1/orders/internal/depot-customers?depotId=d1',
      // Audit F-3: the deadline is part of the contract — this adapter fails soft, so
      // without it a hung order-service held the CRM directory open with no error.
      { headers: { 'x-internal-key': KEY }, signal: expect.any(AbortSignal) },
    );
    expect(out[0]!.firstOrderAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(out[1]).toMatchObject({ customerId: 'c2', firstOrderAt: null, lastOrderAt: null });
  });

  it('returns [] on non-ok, missing customers array, and fetch rejection', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    expect(await new OrderCrmHttpAdapter(cfg()).depotCustomerStats('d1')).toEqual([]);
    fetchMock.mockResolvedValueOnce(res({ ok: true, json: {} }));
    expect(await new OrderCrmHttpAdapter(cfg()).depotCustomerStats('d1')).toEqual([]);
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await new OrderCrmHttpAdapter(cfg()).depotCustomerStats('d1')).toEqual([]);
  });

  describe('customerOrders', () => {
    it('passes both ids and returns the orders verbatim', async () => {
      const orders = [{ id: 'o1', orderNumber: 'HM-1', status: 'COMPLETED', totalIdr: 50_000, placedAt: '2026-08-02T00:00:00.000Z' }];
      fetchMock.mockResolvedValue(res({ ok: true, json: { orders } }));

      await expect(new OrderCrmHttpAdapter(cfg()).customerOrders('d1', 'c1')).resolves.toEqual(orders);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://order:3004/api/v1/orders/internal/customer-orders?depotId=d1&customerId=c1',
        { headers: { 'x-internal-key': KEY }, signal: expect.any(AbortSignal) },
      );
    });

    it('returns [] when unconfigured, refused, unreachable, or handed a body with no orders', async () => {
      expect(await new OrderCrmHttpAdapter(cfg({ orderServiceUrl: '' })).customerOrders('d1', 'c1')).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockResolvedValueOnce(res({ ok: false, status: 500 }));
      expect(await new OrderCrmHttpAdapter(cfg()).customerOrders('d1', 'c1')).toEqual([]);
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await new OrderCrmHttpAdapter(cfg()).customerOrders('d1', 'c1')).toEqual([]);
      fetchMock.mockResolvedValueOnce(res({ ok: true, json: {} }));
      expect(await new OrderCrmHttpAdapter(cfg()).customerOrders('d1', 'c1')).toEqual([]);
    });
  });
});

describe('ProductCatalogHttpAdapter', () => {
  const adapter = (over = {}) =>
    new ProductCatalogHttpAdapter(makeConfig({ productServiceUrl: 'http://product:3003', ...over }));

  it('skips the check entirely when product-service is not configured', async () => {
    await expect(adapter({ productServiceUrl: '' }).exists('p1')).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unknown ONLY on a definitive 404', async () => {
    fetchMock.mockResolvedValue(res({ status: 404 }));
    await expect(adapter().exists('ghost')).resolves.toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe('http://product:3003/api/v1/products/ghost');
  });

  it('reports exists on 200', async () => {
    fetchMock.mockResolvedValue(res({ status: 200 }));
    await expect(adapter().exists('p1')).resolves.toBe(true);
  });

  // Fails OPEN: a catalog outage must not stop a customer favouriting a product they
  // can already see on the page.
  it('fails open on a 5xx and on a transport error', async () => {
    fetchMock.mockResolvedValue(res({ status: 500 }));
    await expect(adapter().exists('p1')).resolves.toBe(true);

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(adapter().exists('p1')).resolves.toBe(true);
  });

  it('url-encodes the product id', async () => {
    fetchMock.mockResolvedValue(res({ status: 200 }));
    await adapter().exists('a/b?c');
    expect(fetchMock.mock.calls[0][0]).toBe('http://product:3003/api/v1/products/a%2Fb%3Fc');
  });
});

describe('IdentityHttpAdapter.preRegisterCustomer', () => {
  const config = makeConfig({ authServiceUrl: 'http://auth:3001/' });

  it('posts the phone to the internal pre-register route with the shared key', async () => {
    fetchMock.mockResolvedValue(res({ json: { customerId: 'cust-1', status: 'created' } }));

    await expect(
      new IdentityHttpAdapter(config).preRegisterCustomer('081200001111', 'Siti'),
    ).resolves.toEqual({ customerId: 'cust-1', status: 'created' });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth:3001/api/v1/auth/internal/customers/pre-register');
    expect(options.headers['x-internal-key']).toBe(KEY);
    expect(JSON.parse(options.body)).toEqual({ phone: '081200001111', fullName: 'Siti' });
  });

  it('throws without calling fetch when the url or key is unset', async () => {
    await expect(
      new IdentityHttpAdapter(makeConfig({ authServiceUrl: '' })).preRegisterCustomer('0812'),
    ).rejects.toThrow(/belum diset/);
    await expect(
      new IdentityHttpAdapter(
        makeConfig({ authServiceUrl: 'http://auth:3001', internalServiceKey: '' }),
      ).preRegisterCustomer('0812'),
    ).rejects.toThrow(/belum diset/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx response, carrying the status', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 422 }));
    await expect(new IdentityHttpAdapter(config).preRegisterCustomer('0812')).rejects.toThrow(/422/);
  });

  it('throws when the call itself fails, Error or not', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(new IdentityHttpAdapter(config).preRegisterCustomer('0812')).rejects.toThrow(
      /ETIMEDOUT/,
    );
    fetchMock.mockRejectedValue('boom');
    await expect(new IdentityHttpAdapter(config).preRegisterCustomer('0812')).rejects.toThrow(
      /unknown/,
    );
  });

  it('throws when the body carries no identity', async () => {
    fetchMock.mockResolvedValue(res({ json: { status: 'created' } }));
    await expect(new IdentityHttpAdapter(config).preRegisterCustomer('0812')).rejects.toThrow(
      /tidak mengembalikan identitas/,
    );
  });
});

// The read side is the mirror image of the write side above: it must NEVER throw, because
// a depot's customer list has to render even when auth-service is down — just with the
// names the caller already had.
describe('IdentityHttpAdapter.getCustomerNames', () => {
  const config = makeConfig({ authServiceUrl: 'http://auth:3001/' });

  it('posts the deduplicated ids and maps the rows back by id', async () => {
    fetchMock.mockResolvedValue(
      res({ json: [{ id: 'c1', fullName: 'Budi', phone: '0811' }, { id: 'c2', fullName: null }] }),
    );

    const out = await new IdentityHttpAdapter(config).getCustomerNames(['c1', 'c2', 'c1', '']);

    expect(out.get('c1')).toEqual({ fullName: 'Budi', phone: '0811' });
    // A PENDING account has no name yet: absent fields normalise to null, not undefined.
    expect(out.get('c2')).toEqual({ fullName: null, phone: null });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://auth:3001/api/v1/auth/internal/customers/by-ids');
    expect(options.headers['x-internal-key']).toBe(KEY);
    expect(JSON.parse(options.body)).toEqual({ ids: ['c1', 'c2'] });
  });

  it('skips rows with no id', async () => {
    fetchMock.mockResolvedValue(res({ json: [{ fullName: 'Nobody' }] }));
    expect((await new IdentityHttpAdapter(config).getCustomerNames(['c1'])).size).toBe(0);
  });

  it('returns empty without calling fetch when there is nothing to ask, or nowhere to ask', async () => {
    const adapter = new IdentityHttpAdapter(config);
    expect((await adapter.getCustomerNames([])).size).toBe(0);
    expect((await adapter.getCustomerNames([''])).size).toBe(0);
    expect((await new IdentityHttpAdapter(makeConfig({ authServiceUrl: '' })).getCustomerNames(['c1'])).size).toBe(0);
    expect(
      (
        await new IdentityHttpAdapter(
          makeConfig({ authServiceUrl: 'http://auth:3001', internalServiceKey: '' }),
        ).getCustomerNames(['c1'])
      ).size,
    ).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades to no names on a rejected call or a non-2xx answer', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    expect((await new IdentityHttpAdapter(config).getCustomerNames(['c1'])).size).toBe(0);
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    expect((await new IdentityHttpAdapter(config).getCustomerNames(['c1'])).size).toBe(0);
  });

  it('splits a depot bigger than one lookup into batches', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`);
    fetchMock.mockResolvedValue(res({ json: [] }));

    await new IdentityHttpAdapter(config).getCustomerNames(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).ids).toHaveLength(200);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).ids).toEqual(['c200']);
  });
});
