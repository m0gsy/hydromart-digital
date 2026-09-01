import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { getSession, setSession } from '@/lib/session-store';

/**
 * A refresh that gets no answer must not sign anybody out.
 *
 * The access token lasts 15 minutes, so this path runs constantly; it only has to be
 * unlucky once. Before the fix the refresh's `.catch` cleared the session on ANY failure,
 * and the client throws for three quite different things: 401 (the credential is dead),
 * 408 (its own 15-second deadline elapsed) and 0 (the socket dropped). Two of those mean
 * "no answer", not "no" — and users were being signed out of healthy 30-day sessions on a
 * train, in a lift, or whenever the box was briefly busy.
 *
 * Every test drives the real client: a request 401s, the client refreshes, and the refresh
 * gets the answer under test.
 */

const SESSION = {
  customer: { id: 'c1', name: 'Budi', phone: '+628123456789', role: 'CUSTOMER' },
} as unknown as Parameters<typeof setSession>[0];

function res(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 401 on the first call (the real request), then `refreshAnswer` on the refresh. */
function fetchThatRefreshesWith(refreshAnswer: (init?: RequestInit) => Promise<Response>) {
  let call = 0;
  return vi.fn(async (_url: string, init?: RequestInit) => {
    call += 1;
    if (call === 1) return res(401, { code: 'AUTH_TOKEN_EXPIRED' });
    return refreshAnswer(init);
  });
}

/** Never answers, but honours the abort the client attaches — that is what makes it a 408. */
const hangs = (init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });

describe('a refresh with no answer keeps the session', () => {
  beforeEach(() => {
    api.invalidate();
    setSession(SESSION);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setSession(null);
  });

  it('keeps the session when the refresh times out', async () => {
    vi.stubGlobal('fetch', fetchThatRefreshesWith(hangs));
    vi.useFakeTimers();
    const call = api.get('/api/v1/timeout-case', true).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await call;
    // The request itself still fails — that part was always right. The sign-out is the bug.
    expect(err).toBeInstanceOf(ApiError);
    expect(getSession()).not.toBeNull();
  });

  it('keeps the session when the socket drops mid-refresh', async () => {
    vi.stubGlobal(
      'fetch',
      fetchThatRefreshesWith(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await api.get('/api/v1/dropped-case', true).catch(() => undefined);
    expect(getSession()).not.toBeNull();
  });

  it('keeps the session when the refresh 500s', async () => {
    // A server error says nothing about the credential either.
    vi.stubGlobal(
      'fetch',
      fetchThatRefreshesWith(async () => res(500, { message: 'boom' })),
    );
    await api.get('/api/v1/server-error-case', true).catch(() => undefined);
    expect(getSession()).not.toBeNull();
  });

  it('DOES sign out when the refresh is refused', async () => {
    vi.stubGlobal(
      'fetch',
      fetchThatRefreshesWith(async () => res(401, { code: 'AUTH_REFRESH_INVALID' })),
    );
    await api.get('/api/v1/refused-case', true).catch(() => undefined);
    expect(getSession()).toBeNull();
  });

  it('DOES sign out when the refresh is forbidden', async () => {
    vi.stubGlobal(
      'fetch',
      fetchThatRefreshesWith(async () => res(403, { code: 'AUTH_REFRESH_REVOKED' })),
    );
    await api.get('/api/v1/forbidden-case', true).catch(() => undefined);
    expect(getSession()).toBeNull();
  });
});
