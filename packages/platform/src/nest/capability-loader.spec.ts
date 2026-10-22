import { httpCapabilityLoader } from './capability-refresh';

const CFG = { authServiceUrl: 'http://auth:3001', internalKey: 'k' };

describe('httpCapabilityLoader', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  const ok = (body: unknown) => fetchMock.mockResolvedValue({ ok: true, json: async () => body });

  it('reads the override patch with the internal key', async () => {
    ok({ overrides: { dashboard: ['SUPER_ADMIN'] } });
    expect((await httpCapabilityLoader(CFG)()).overrides).toEqual({ dashboard: ['SUPER_ADMIN'] });
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://auth:3001/api/v1/access/internal/overrides');
    expect(init.headers['x-internal-key']).toBe('k');
  });

  it.each([
    ['no url', { internalKey: 'k' }],
    ['no key', { authServiceUrl: 'http://auth:3001' }],
  ])(
    'throws when configured with %s, so the refresher keeps the last snapshot',
    async (_c, cfg) => {
      await expect(httpCapabilityLoader(cfg)()).rejects.toThrow('not configured');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('throws on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(httpCapabilityLoader(CFG)()).rejects.toThrow('HTTP 503');
  });

  /**
   * This payload decides who may do what and it crosses a network boundary, so a
   * malformed entry must never become a permission. Everything below is dropped
   * rather than coerced.
   */
  describe('sanitising the payload', () => {
    it.each([
      ['a missing overrides key', {}],
      ['a null body', null],
      ['a null overrides', { overrides: null }],
      ['a non-object overrides', { overrides: 'nope' }],
    ])('returns an empty patch for %s', async (_case, body) => {
      ok(body);
      expect((await httpCapabilityLoader(CFG)()).overrides).toEqual({});
    });

    it('drops a non-array value and keeps the well-formed siblings', async () => {
      ok({ overrides: { good: ['HR'], bad: 'HR', alsoBad: 7 } });
      expect((await httpCapabilityLoader(CFG)()).overrides).toEqual({ good: ['HR'] });
    });

    it('drops non-string members inside an otherwise valid array', async () => {
      ok({ overrides: { mixed: ['HR', 42, null, 'FINANCE'] } });
      expect((await httpCapabilityLoader(CFG)()).overrides).toEqual({ mixed: ['HR', 'FINANCE'] });
    });

    // A `__proto__` key in a JSON body is a prototype-pollution attempt, and this one
    // would land in the map every guard reads.
    it('drops prototype keys', async () => {
      ok({
        overrides: {
          __proto__: ['SUPER_ADMIN'],
          constructor: ['SUPER_ADMIN'],
          prototype: ['SUPER_ADMIN'],
          real: ['HR'],
        },
      });
      const out = (await httpCapabilityLoader(CFG)()).overrides;
      expect(out).toEqual({ real: ['HR'] });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  describe('custom roles and depot overrides', () => {
    const DEPOT = '11111111-1111-1111-1111-111111111111';

    it('reads well-formed custom roles and per-depot exceptions', async () => {
      ok({
        overrides: {},
        customRoles: [{ key: 'C_kasir', name: 'Kasir', scope: 'LOCKED' }],
        depotOverrides: [{ capability: 'dashboard', roleKey: 'C_kasir', depotId: DEPOT, effect: 'GRANT' }],
      });
      const out = await httpCapabilityLoader(CFG)();
      expect(out.customRoles).toEqual([{ key: 'C_kasir', name: 'Kasir', scope: 'LOCKED' }]);
      expect(out.depotOverrides).toEqual([
        { capability: 'dashboard', roleKey: 'C_kasir', depotId: DEPOT, effect: 'GRANT' },
      ]);
    });

    it('drops every malformed custom role', async () => {
      ok({
        customRoles: [
          null,
          { key: 'MANAGER', name: 'x', scope: 'GLOBAL' },
          { key: 'C_a', name: 7, scope: 'GLOBAL' },
          { key: 'C_b', name: 'b', scope: 'EVERYWHERE' },
          { key: 'C_ok', name: 'ok', scope: 'RESOLVED' },
        ],
      });
      expect((await httpCapabilityLoader(CFG)()).customRoles).toEqual([
        { key: 'C_ok', name: 'ok', scope: 'RESOLVED' },
      ]);
    });

    it('drops every malformed depot exception, including a prototype capability', async () => {
      ok({
        depotOverrides: [
          null,
          { capability: '__proto__', roleKey: 'C_a', depotId: DEPOT, effect: 'GRANT' },
          { capability: 'dashboard', roleKey: 'C_a', depotId: DEPOT, effect: 'MAYBE' },
          { capability: 'dashboard', roleKey: 'C_a', depotId: 5, effect: 'GRANT' },
          { capability: 'dashboard', roleKey: 'C_a', depotId: DEPOT, effect: 'DENY' },
        ],
      });
      expect((await httpCapabilityLoader(CFG)()).depotOverrides).toEqual([
        { capability: 'dashboard', roleKey: 'C_a', depotId: DEPOT, effect: 'DENY' },
      ]);
    });

    it('an old source that sends neither field yields none', async () => {
      ok({ overrides: { a: ['HR'] } });
      const out = await httpCapabilityLoader(CFG)();
      expect(out.customRoles).toEqual([]);
      expect(out.depotOverrides).toEqual([]);
    });
  });

  it('aborts a hung auth-service rather than blocking the refresh loop', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(new Error('aborted')));
        }),
    );
    jest.useFakeTimers();
    const promise = httpCapabilityLoader(CFG)();
    const assertion = expect(promise).rejects.toThrow();
    jest.advanceTimersByTime(6000);
    await assertion;
    jest.useRealTimers();
  });
});
