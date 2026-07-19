import { CustomerConfigService } from '../../src/config/customer-config.service';
import { LoyaltyRewardHttpAdapter } from '../../src/infrastructure/http/loyalty-reward.http.adapter';

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

function res(init: { ok?: boolean; status?: number }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return { ok: init.ok ?? status < 400, status } as unknown as Response;
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
