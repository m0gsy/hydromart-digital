import { AccountSuspensionHttpAdapter } from '../../src/infrastructure/http/account-suspension.http.adapter';
import { AdminConfigService } from '../../src/config/admin-config.service';

/**
 * CA-2-05: the wire that makes "Blokir" mean something.
 *
 * Every one of these is about failing CLOSED. Most outbound calls in this service fail open
 * — a dropped audit entry is a gap in a record. This one is not: a fraud flag that reads
 * BLOCKED while the account still signs in is the exact state being fixed, so every failure
 * has to reach the caller.
 */
describe('AccountSuspensionHttpAdapter (CA-2-05)', () => {
  const config = (over: Partial<AdminConfigService> = {}) =>
    ({
      authServiceUrl: 'http://auth:3001',
      internalServiceKey: 'internal-key',
      ...over,
    }) as AdminConfigService;

  afterEach(() => jest.restoreAllMocks());

  it('asks auth-service to suspend the account, with the internal key', async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    global.fetch = jest.fn(async (url: string, init: never) => {
      calls.push({ url: String(url), init: init as never });
      return { ok: true, status: 200 } as never;
    }) as never;

    await new AccountSuspensionHttpAdapter(config()).setActive('cust-1', false);

    expect(calls[0]!.url).toBe('http://auth:3001/api/v1/auth/internal/customers/status');
    expect(calls[0]!.init.headers['x-internal-key']).toBe('internal-key');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ customerId: 'cust-1', active: false });
  });

  it('throws when auth-service refuses, so the flag is not recorded as blocked', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 }) as never) as never;

    await expect(
      new AccountSuspensionHttpAdapter(config()).setActive('cust-1', false),
    ).rejects.toThrow(/503/);
  });

  it('throws when the network fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as never;

    await expect(
      new AccountSuspensionHttpAdapter(config()).setActive('cust-1', false),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  /*
   * An unconfigured environment is a REFUSAL, not a pass. Silently skipping here is how a
   * block that never happened would get recorded as one — the same shape as the bug.
   */
  it.each([
    ['no auth URL', { authServiceUrl: '' }],
    ['no internal key', { internalServiceKey: '' }],
  ])('refuses with %s rather than skipping', async (_label, over) => {
    global.fetch = jest.fn() as never;

    await expect(
      new AccountSuspensionHttpAdapter(config(over as never)).setActive('cust-1', false),
    ).rejects.toThrow(/not configured/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
