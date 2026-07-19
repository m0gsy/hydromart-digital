import { PromoConfigService } from '../../src/config/promo-config.service';
import { CustomerLookupHttpAdapter } from '../../src/infrastructure/http/customer-lookup.http.adapter';
import { NotificationHttpAdapter } from '../../src/infrastructure/http/notification.http.adapter';

// Exercises the REAL HTTP adapter code (URL building, headers, res.ok branches,
// fail-open catch, response parsing) against a mocked global.fetch — the units the
// e2e's Fake* stand-ins never run. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): PromoConfigService {
  return {
    crmServiceUrl: 'http://crm:3012',
    customerServiceUrl: 'http://customer:3002',
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
