import { httpAccountNameResolver } from './account-name-resolver';

describe('httpAccountNameResolver', () => {
  const cfg = { authServiceUrl: 'http://auth:3001/', internalKey: 'k' };
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps ids to account names, de-duplicating and dropping blanks', async () => {
    const sent: unknown[] = [];
    global.fetch = jest.fn(async (url, init) => {
      expect(String(url)).toBe('http://auth:3001/api/v1/auth/internal/customers/by-ids');
      expect((init as RequestInit).headers).toMatchObject({ 'x-internal-key': 'k' });
      sent.push(JSON.parse(String((init as RequestInit).body)));
      return new Response(
        JSON.stringify([
          { id: 'c1', fullName: 'Budi' },
          // No name on the account (a PENDING invite): left out, so the caller's own
          // fallback wins instead of rendering an empty cell.
          { id: 'c2', fullName: null },
          { id: '', fullName: 'ignored' },
        ]),
      );
    }) as typeof fetch;

    const out = await httpAccountNameResolver(cfg)(['c1', 'c1', '', 'c2']);

    expect(sent).toEqual([{ ids: ['c1', 'c2'] }]);
    expect([...out]).toEqual([['c1', 'Budi']]);
  });

  it('never calls out when unconfigured or given nothing to resolve', async () => {
    global.fetch = jest.fn() as typeof fetch;

    expect((await httpAccountNameResolver({})(['c1'])).size).toBe(0);
    expect((await httpAccountNameResolver({ authServiceUrl: 'http://a' })(['c1'])).size).toBe(0);
    expect((await httpAccountNameResolver(cfg)([])).size).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // The whole point of the decoration failing soft: a refund queue that cannot resolve a
  // name still has to answer with the queue.
  it('degrades to no names on a refusal or an outage', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
    expect((await httpAccountNameResolver(cfg)(['c1'])).size).toBe(0);

    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    expect((await httpAccountNameResolver(cfg)(['c1'])).size).toBe(0);
  });

  // The abort timer this arms had never been let fire: a hung auth-service must still let
  // the list it decorates answer, rather than holding the request open for its whole life.
  it('aborts a hung lookup and answers with no names', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => {
            const aborted = new Error('The operation was aborted');
            aborted.name = 'AbortError';
            reject(aborted);
          });
        }),
    ) as unknown as typeof fetch;

    // The handler has to be attached before the timer fires, or the rejection lands unhandled.
    const settled = httpAccountNameResolver(cfg)(['c1']);
    await jest.advanceTimersByTimeAsync(10_000);
    expect((await settled).size).toBe(0);
    jest.useRealTimers();
  });

  it('splits a lookup wider than auth-service accepts into batches', async () => {
    const batches: number[] = [];
    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { ids: string[] };
      batches.push(body.ids.length);
      return new Response(JSON.stringify(body.ids.map((id) => ({ id, fullName: `n-${id}` }))));
    }) as typeof fetch;

    const ids = Array.from({ length: 250 }, (_, i) => `c${i}`);
    const out = await httpAccountNameResolver(cfg)(ids);

    expect(batches).toEqual([200, 50]);
    expect(out.size).toBe(250);
  });
});
