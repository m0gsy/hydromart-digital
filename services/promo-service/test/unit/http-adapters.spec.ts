import { PromoConfigService } from '../../src/config/promo-config.service';
import { CustomerLookupHttpAdapter } from '../../src/infrastructure/http/customer-lookup.http.adapter';
import { NotificationHttpAdapter } from '../../src/infrastructure/http/notification.http.adapter';
import { OrderValueHttpAdapter } from '../../src/infrastructure/http/order-value.http.adapter';

// Exercises the REAL HTTP adapter code (URL building, headers, res.ok branches,
// fail-open catch, response parsing) against a mocked global.fetch — the units the
// e2e's Fake* stand-ins never run. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): PromoConfigService {
  return {
    crmServiceUrl: 'http://crm:3012',
    customerServiceUrl: 'http://customer:3002',
    orderServiceUrl: 'http://order:3004',
    internalServiceKey: KEY,
    ...over,
  } as unknown as PromoConfigService;
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

describe('CustomerLookupHttpAdapter', () => {
  it('returns null without base url or authorization (no fetch)', async () => {
    expect(await new CustomerLookupHttpAdapter(makeConfig({ customerServiceUrl: '' })).resolve('c1', 'Bearer x')).toBeNull();
    expect(await new CustomerLookupHttpAdapter(makeConfig()).resolve('c1', '')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves matching contact on happy path', async () => {
    fetchMock.mockResolvedValue(
      res({
        body: [
          { customerId: 'c1', name: 'Budi', phone: '0811' },
          { customerId: 'c2', name: 'Sari', phone: '0822' },
        ],
      }),
    );
    const out = await new CustomerLookupHttpAdapter(makeConfig()).resolve('c2', 'Bearer x');
    expect(out).toEqual({ name: 'Sari', phone: '0822' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/profile/directory',
      expect.objectContaining({ headers: { authorization: 'Bearer x' } }),
    );
  });

  it('returns null when no directory entry matches', async () => {
    fetchMock.mockResolvedValue(res({ body: [{ customerId: 'other', name: 'X', phone: '0' }] }));
    expect(await new CustomerLookupHttpAdapter(makeConfig()).resolve('c1', 'Bearer x')).toBeNull();
  });

  it('fails open (null) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await new CustomerLookupHttpAdapter(makeConfig()).resolve('c1', 'Bearer x')).toBeNull();
  });

  it('fails open (null) when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await new CustomerLookupHttpAdapter(makeConfig()).resolve('c1', 'Bearer x')).toBeNull();
  });
});

describe('NotificationHttpAdapter', () => {
  it('skips without internal key or base url (no fetch)', async () => {
    await new NotificationHttpAdapter(makeConfig({ internalServiceKey: '' })).notify('e', '0811', 'c1', {});
    await new NotificationHttpAdapter(makeConfig({ crmServiceUrl: '' })).notify('e', '0811', 'c1', {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to crm internal endpoint on happy path', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new NotificationHttpAdapter(makeConfig()).notify('VOUCHER_GRANTED', '0811', 'c1', { code: 'HEMAT' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://crm:3012/api/v1/notifications/internal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-key': KEY }),
      }),
    );
  });

  it('fails open (resolves) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new NotificationHttpAdapter(makeConfig()).notify('e', '0811', 'c1', {}),
    ).resolves.toBeUndefined();
  });

  it('fails open (resolves) when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new NotificationHttpAdapter(makeConfig()).notify('e', '0811', 'c1', {}),
    ).resolves.toBeUndefined();
  });
});

describe('OrderValueHttpAdapter', () => {
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ];

  it('posts batches with the internal key and returns complete integer-IDR values', async () => {
    fetchMock.mockResolvedValue(
      res({
        body: [
          { orderId: ids[0], totalIdr: 25_000 },
          { orderId: ids[1], totalIdr: 40_000 },
        ],
      }),
    );

    const result = await new OrderValueHttpAdapter(makeConfig()).findOrderValues(ids);

    expect(result).toEqual([
      { orderId: ids[0], totalIdr: 25_000 },
      { orderId: ids[1], totalIdr: 40_000 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3004/api/v1/orders/internal/values',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-key': KEY }),
        body: JSON.stringify({ orderIds: ids }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('chunks more than 500 ids while preserving a complete result', async () => {
    const manyIds = Array.from(
      { length: 501 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const orderIds = (JSON.parse(String(init.body)) as { orderIds: string[] }).orderIds;
      return res({ body: orderIds.map((orderId) => ({ orderId, totalIdr: 1 })) });
    });

    expect(await new OrderValueHttpAdapter(makeConfig()).findOrderValues(manyIds)).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing configuration', makeConfig({ orderServiceUrl: '' }), undefined],
    ['non-2xx', makeConfig(), res({ ok: false, status: 503 })],
    ['malformed body', makeConfig(), res({ body: { values: [] } })],
    ['invalid money', makeConfig(), res({ body: ids.map((orderId) => ({ orderId, totalIdr: 1.5 })) })],
    ['incomplete body', makeConfig(), res({ body: [{ orderId: ids[0], totalIdr: 25_000 }] })],
  ])('fails open to null for %s', async (_label, config, response) => {
    if (response) fetchMock.mockResolvedValue(response);
    await expect(new OrderValueHttpAdapter(config).findOrderValues(ids)).resolves.toBeNull();
  });

  it('fails open to null on timeout or network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(new OrderValueHttpAdapter(makeConfig()).findOrderValues(ids)).resolves.toBeNull();
  });
});
