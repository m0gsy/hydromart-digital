import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';

/**
 * Audit F-1/F-2/F-3 regression suite. Each test here fails against the pre-fix client:
 * it had no deadline, parsed any body bare, ignored 429, and fired one request per
 * caller. The assertions are on CALL COUNTS and thrown statuses, so nothing depends on
 * a running gateway.
 */

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A fetch that never answers, but honours the abort signal the client attaches. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
}

beforeEach(() => api.invalidate());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('request deadline (F-3)', () => {
  it('a request that never answers is aborted and surfaces as 408, not a hung promise', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    // The handler is attached in the same tick the promise is created: `expect(...).rejects`
    // attaches one turn later, and under fake timers the rejection lands first — vitest
    // then reports it as an unhandled error even though the assertion passes.
    const settled = api.get('/slow').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await settled).toMatchObject({ status: 408 });
  });
});

describe('response parsing (F-3)', () => {
  it('a non-JSON error body reports the status instead of throwing SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })),
    );
    const err: unknown = await api.get('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
  });

  it('a non-JSON success body resolves to undefined rather than crashing the caller', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(api.get('/x')).resolves.toBeUndefined();
  });
});

describe('rate limiting (F-3)', () => {
  it('a 429 is retried once after Retry-After and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(429, { message: 'slow down' }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('/x')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a second 429 is surfaced, not retried forever', async () => {
    const fetchMock = vi.fn(async () => json(429, {}, { 'retry-after': '0' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('/x')).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('request sharing (F-1/F-2)', () => {
  /*
   * Retry-After is what separates the two kinds of 429, and only one of them is worth
   * waiting on.
   *
   * The gateway's rate limiter sends the header: the burst passes and a retry succeeds. A
   * business rule does not — the OTP resend cooldown answers 429 with AUTH_OTP_COOLDOWN and
   * no header, and it will still be refusing half a second later. Retrying it bought nothing
   * and delayed the explanation the customer needed by a whole round trip.
   */
  it('a 429 with no Retry-After is surfaced at once, not retried', async () => {
    const fetchMock = vi.fn(async () =>
      json(429, { code: 'AUTH_OTP_COOLDOWN', message: 'Please wait 31s' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.post('/api/v1/auth/login', { phone: '+628' })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('concurrent identical GETs cost one round-trip', async () => {
    const fetchMock = vi.fn(async () => json(200, { n: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b, c] = await Promise.all([api.get('/same'), api.get('/same'), api.get('/same')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('a settled plain GET is NOT reused — a retry must reach the server', async () => {
    const fetchMock = vi.fn(async () => json(200, { n: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.get('/same');
    await api.get('/same');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a failure is never cached', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(500, {}))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.getCached('/ref')).rejects.toBeInstanceOf(ApiError);
    await expect(api.getCached('/ref')).resolves.toEqual({ ok: true });
  });

  it('getCached serves reference data from memory within its TTL', async () => {
    const fetchMock = vi.fn(async () => json(200, [{ id: 'c1' }]));
    vi.stubGlobal('fetch', fetchMock);
    await api.getCached('/categories');
    await api.getCached('/categories');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('any mutation drops the cache, so the next read is fresh', async () => {
    const fetchMock = vi.fn(async () => json(200, { v: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.getCached('/categories');
    await api.post('/categories', { name: 'new' });
    await api.getCached('/categories');
    // read, write, read — the middle call is the mutation.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('an authenticated read is not served from an anonymous one', async () => {
    const fetchMock = vi.fn(async () => json(200, { v: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.getCached('/thing', false);
    await api.getCached('/thing', true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
