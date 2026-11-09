import { ReferralConfigService } from '../../src/config/referral-config.service';
import { LoyaltyRewardHttpAdapter } from '../../src/infrastructure/http/loyalty-reward.http.adapter';
import { CustomerDirectoryHttpAdapter } from '../../src/infrastructure/http/customer-directory.http.adapter';
import { OrderHistoryHttpAdapter } from '../../src/infrastructure/http/order-history.http.adapter';

// Exercises the REAL HTTP adapter code (URL building, x-internal-key header, res.ok
// branch, fail-open catch, response parsing) against a mocked global.fetch — the units
// the e2e's Fake* stand-ins never run. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): ReferralConfigService {
  return {
    loyaltyServiceUrl: 'http://loyalty:3009',
    customerServiceUrl: 'http://customer:3002',
    orderServiceUrl: 'http://order:3004',
    internalServiceKey: KEY,
    ...over,
  } as unknown as ReferralConfigService;
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

describe('LoyaltyRewardHttpAdapter', () => {
  it('reverses by key and propagates a downstream failure', async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true })).mockResolvedValueOnce(res({ ok: false, status: 503 }));
    const adapter = new LoyaltyRewardHttpAdapter(makeConfig());
    await adapter.reverse('c1', 'referral:id:order:referrer');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://loyalty:3009/api/v1/loyalty/internal/reverse-reward',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-internal-key': KEY }) }),
    );
    await expect(adapter.reverse('c1', 'referral:id:order:referrer')).rejects.toThrow('503');
  });
  it('refuses reversal without the internal key', async () => {
    await expect(new LoyaltyRewardHttpAdapter(makeConfig({ internalServiceKey: '' }))
      .reverse('c1', 'referral:id:order:referrer')).rejects.toThrow('No internal service key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects when no internal key so the outbox retries', async () => {
    await expect(new LoyaltyRewardHttpAdapter(makeConfig({ internalServiceKey: '' })).reward('c1', 50, 'referral', '', 'ref-1')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to loyalty/reward with x-internal-key on happy path', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new LoyaltyRewardHttpAdapter(makeConfig()).reward('c1', 50, 'referral', '', 'ref-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://loyalty:3009/api/v1/loyalty/reward',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-key': KEY }),
      }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).idempotencyKey).toBe('ref-1');
  });

  it('rejects on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new LoyaltyRewardHttpAdapter(makeConfig()).reward('c1', 50, 'referral', '', 'ref-1'),
    ).rejects.toThrow();
  });

  it('rejects when loyalty is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new LoyaltyRewardHttpAdapter(makeConfig()).reward('c1', 50, 'referral', '', 'ref-1'),
    ).rejects.toThrow();
  });
});

describe('CustomerDirectoryHttpAdapter', () => {
  it('returns [] when no key', async () => {
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
    fetchMock.mockResolvedValue(res({ body: { customerIds: ['c1', 'c2', 42, 'c3'] } }));
    const out = await new CustomerDirectoryHttpAdapter(makeConfig()).customerIdsForDepot('d 1');
    expect(out).toEqual(['c1', 'c2', 'c3']); // non-string entries filtered out
    expect(fetchMock).toHaveBeenCalledWith(
      'http://customer:3002/api/v1/customers/internal/by-depot?depotId=d%201',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-internal-key': KEY }) }),
    );
  });

  // CUS-06: by-depot is paged; follow nextCursor, and stop if it does not advance.
  it('follows nextCursor until the last page (CUS-06)', async () => {
    fetchMock
      .mockResolvedValueOnce(res({ body: { customerIds: ['c1', 'c2'], nextCursor: 'c2' } }))
      .mockResolvedValueOnce(res({ body: { customerIds: ['c3'], nextCursor: null } }));
    const out = await new CustomerDirectoryHttpAdapter(makeConfig()).customerIdsForDepot('d1');
    expect(out).toEqual(['c1', 'c2', 'c3']);
    expect(fetchMock.mock.calls[1][0]).toContain('after=c2');
  });

  it('stops when the cursor does not advance (CUS-06)', async () => {
    fetchMock.mockResolvedValue(res({ body: { customerIds: ['c1'], nextCursor: 'c1' } }));
    const out = await new CustomerDirectoryHttpAdapter(makeConfig()).customerIdsForDepot('d1');
    expect(out).toEqual(['c1', 'c1']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns [] when customerIds is absent/not an array', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
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

/**
 * CA-3-40. Every branch returns `null`, not `false`: this adapter is the one that fails
 * CLOSED, and a `false` from a broken call would hand out 750 unreclaimable points.
 */
describe('OrderHistoryHttpAdapter', () => {
  it('reads only valid completed/voided statuses for retry decisions', async () => {
    const adapter = new OrderHistoryHttpAdapter(makeConfig());
    fetchMock.mockResolvedValueOnce(res({ body: { status: 'VOIDED' } }))
      .mockResolvedValueOnce(res({ body: { status: 'bogus' } }));
    expect(await adapter.statusOfOrder('o1')).toBe('VOIDED');
    expect(await adapter.statusOfOrder('o1')).toBeNull();
  });
  it('fails closed when status lookup is unconfigured, rejected or unreachable', async () => {
    expect(await new OrderHistoryHttpAdapter(makeConfig({ internalServiceKey: '' })).statusOfOrder('o1')).toBeNull();
    expect(await new OrderHistoryHttpAdapter(makeConfig({ orderServiceUrl: '' })).statusOfOrder('o1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(res({ ok: false, status: 503 })).mockRejectedValueOnce(new Error('offline'));
    const adapter = new OrderHistoryHttpAdapter(makeConfig());
    expect(await adapter.statusOfOrder('o1')).toBeNull();
    expect(await adapter.statusOfOrder('o1')).toBeNull();
  });
  const ask = (over = {}) => new OrderHistoryHttpAdapter(makeConfig(over)).hasCompletedOrder('c1');

  it('returns null when no key', async () => {
    expect(await ask({ internalServiceKey: '' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when no order-service url', async () => {
    expect(await ask({ orderServiceUrl: '' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads hasCompleted (url-encoded + x-internal-key) on the happy path', async () => {
    fetchMock.mockResolvedValue(res({ body: { hasCompleted: true } }));
    const out = await new OrderHistoryHttpAdapter(makeConfig()).hasCompletedOrder('c 1');
    expect(out).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3004/api/v1/orders/internal/customer-completed?customerId=c%201',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-internal-key': KEY }) }),
    );
  });

  it('passes a false through unchanged', async () => {
    fetchMock.mockResolvedValue(res({ body: { hasCompleted: false } }));
    expect(await ask()).toBe(false);
  });

  it('returns null when the body carries no boolean', async () => {
    fetchMock.mockResolvedValue(res({ body: {} }));
    expect(await ask()).toBeNull();
  });

  it('returns null (fail closed) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await ask()).toBeNull();
  });

  it('returns null (fail closed) when order-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await ask()).toBeNull();
  });
});
