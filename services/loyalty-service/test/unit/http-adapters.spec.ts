import { LoyaltyConfigService } from '../../src/config/loyalty-config.service';
import { CustomerDirectoryHttpAdapter } from '../../src/infrastructure/http/customer-directory.http.adapter';

// Exercises the REAL HTTP adapter code (URL building, x-internal-key header, res.ok
// branch, fail-open catch, response parsing) against a mocked global.fetch — the units
// the e2e's Fake* stand-ins never run. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): LoyaltyConfigService {
  return {
    customerServiceUrl: 'http://customer:3002',
    internalServiceKey: KEY,
    ...over,
  } as unknown as LoyaltyConfigService;
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

describe('CustomerDirectoryHttpAdapter', () => {
  it('returns [] when no key (directory not configured)', async () => {
    const out = await new CustomerDirectoryHttpAdapter(makeConfig({ internalServiceKey: '' })).customerIdsForDepot('d1');
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] when no customer-service url', async () => {
    const out = await new CustomerDirectoryHttpAdapter(makeConfig({ customerServiceUrl: '' })).customerIdsForDepot('d1');
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves depot customerIds (url-encoded + x-internal-key) on happy path', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerIds: ['c1', 'c2', 'c3'] } }));
    const out = await new CustomerDirectoryHttpAdapter(makeConfig()).customerIdsForDepot('d 1');
    expect(out).toEqual(['c1', 'c2', 'c3']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/customers/internal/by-depot?depotId=d%201',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-internal-key': KEY }) }),
    );
  });

  it('returns the customerIds array as-is (no filtering of non-string entries)', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerIds: ['c1', 42, 'c3'] } }));
    const out = await new CustomerDirectoryHttpAdapter(makeConfig()).customerIdsForDepot('d1');
    expect(out).toEqual(['c1', 42, 'c3']);
  });

  it('returns [] when customerIds is absent/not an array', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    expect(await new CustomerDirectoryHttpAdapter(makeConfig()).customerIdsForDepot('d1')).toEqual([]);
  });

  it('returns [] when the response body is not valid JSON', async () => {
    fetchMock.mockResolvedValue(res({ throwJson: true }));
    expect(await new CustomerDirectoryHttpAdapter(makeConfig()).customerIdsForDepot('d1')).toEqual([]);
  });

  it('returns [] (fail open) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await new CustomerDirectoryHttpAdapter(makeConfig()).customerIdsForDepot('d1')).toEqual([]);
  });

  it('returns [] (fail open) when customer-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await new CustomerDirectoryHttpAdapter(makeConfig()).customerIdsForDepot('d1')).toEqual([]);
  });
});
