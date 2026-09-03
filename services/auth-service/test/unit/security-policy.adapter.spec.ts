import { SecurityPolicyHttpAdapter } from '../../src/infrastructure/http/security-policy.http.adapter';
import { AuthConfigService } from '../../src/config/auth-config.service';

/**
 * CA-2-06: the idle-session limit, read from admin-service on the refresh path.
 *
 * Two properties make it safe to put a cross-service read there, and both are what these
 * tests are about: it is CACHED, so the hottest route in the system does not grow a round
 * trip per call; and it FAILS OPEN, because a security control that logs the whole business
 * out when the service holding it restarts is an outage wearing a policy's clothes.
 */
describe('SecurityPolicyHttpAdapter (CA-2-06)', () => {
  const config = (over: Record<string, unknown> = {}) =>
    ({
      securityPolicySource: {
        adminServiceUrl: 'http://admin:3010',
        internalServiceKey: 'internal-key',
        ...over,
      },
    }) as unknown as AuthConfigService;

  afterEach(() => jest.restoreAllMocks());

  it('reads the limit, with the internal key', async () => {
    const calls: { url: string; init: { headers: Record<string, string> } }[] = [];
    global.fetch = jest.fn(async (url: string, init: never) => {
      calls.push({ url: String(url), init: init as never });
      return { ok: true, status: 200, json: async () => ({ idleTimeoutMinutes: 15 }) } as never;
    }) as never;

    expect(await new SecurityPolicyHttpAdapter(config()).idleTimeoutMinutes()).toBe(15);
    expect(calls[0]!.url).toBe('http://admin:3010/api/v1/security-policy/internal');
    expect(calls[0]!.init.headers['x-internal-key']).toBe('internal-key');
  });

  it('asks once and serves the rest from cache', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ idleTimeoutMinutes: 15 }),
    })) as never;
    const adapter = new SecurityPolicyHttpAdapter(config());

    await adapter.idleTimeoutMinutes();
    await adapter.idleTimeoutMinutes();
    await adapter.idleTimeoutMinutes();

    // Refresh is one of the hottest routes in the system; three reads must not be three
    // round trips to another service.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  /*
   * The heart of it. Every one of these is a case where the honest answer is "no idle
   * limit" rather than "everybody is logged out" — the env-driven refresh TTL still bounds
   * every session, so failing open is a weaker limit, never none at all.
   */
  it.each([
    ['admin-service refuses', { ok: false, status: 503, json: async () => ({}) }],
    ['the body is not JSON', { ok: true, status: 200, json: async () => { throw new Error('x') } }],
    ['the field is missing', { ok: true, status: 200, json: async () => ({}) }],
    ['the field is zero', { ok: true, status: 200, json: async () => ({ idleTimeoutMinutes: 0 }) }],
    ['the field is negative', { ok: true, status: 200, json: async () => ({ idleTimeoutMinutes: -5 }) }],
  ])('returns no limit when %s', async (_label, response) => {
    global.fetch = jest.fn(async () => response as never) as never;
    expect(await new SecurityPolicyHttpAdapter(config()).idleTimeoutMinutes()).toBeNull();
  });

  it('returns no limit when the network fails, rather than throwing onto the refresh path', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as never;

    await expect(new SecurityPolicyHttpAdapter(config()).idleTimeoutMinutes()).resolves.toBeNull();
  });

  /*
   * Unconfigured is silent, not warned: a line on every refresh in a dev stack trains
   * people to ignore the log, and this is the one log that has to be worth reading.
   */
  it.each([
    ['no admin URL', { adminServiceUrl: '' }],
    ['no internal key', { internalServiceKey: '' }],
  ])('asks nobody with %s', async (_label, over) => {
    global.fetch = jest.fn() as never;

    expect(await new SecurityPolicyHttpAdapter(config(over)).idleTimeoutMinutes()).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
