/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// F2. The whole native session hinges on ONE fact: the page origin is `https://localhost`
// inside a Capacitor WebView, which is what the docblock above reproduces. Everything
// below is a no-op on any other origin, which the last describe block proves.

const VERIFY = '/auth/api/v1/auth/otp/verify';
const REFRESH = '/auth/api/v1/auth/token/refresh';
const ME = '/auth/api/v1/auth/me';

const SESSION_WITH_TOKENS = {
  tokenType: 'Bearer',
  accessToken: 'AT-1',
  expiresIn: 900,
  refreshToken: 'RT-1',
  customer: { id: 'c1', name: 'Budi', role: 'CUSTOMER' },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * F3b: tokens live in the Keystore, reached through the SecureStorage plugin, so the
 * tests need a plugin to reach. One object, holding one string — which is all the native
 * side is from this file's point of view.
 */
function installVault(initial: string | null = null): { value: string | null } {
  const vault = { value: initial };
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      SecureStorage: {
        internalGetItem: async () => ({ data: vault.value }),
        internalSetItem: async ({ data }: { data: string }) => {
          vault.value = data;
        },
        internalRemoveItem: async () => {
          vault.value = null;
          return { success: true };
        },
      },
      // No screen lock: `unlockTokens` restores without a prompt, which is the path this
      // file cares about. The prompt itself is `native-biometric.test.ts`.
      BiometricAuthNative: {
        checkBiometry: async () => ({ isAvailable: false, deviceIsSecure: false }),
      },
    },
  };
  return vault;
}

/** Fresh module graph per test — `token-store` caches the session in module state. */
async function load(initialVault: string | null = null) {
  vi.resetModules();
  window.localStorage.clear();
  return {
    api: (await import('@/lib/api')).api,
    tokens: await import('@/lib/token-store'),
    vault: installVault(initialVault),
  };
}

function lastInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return fetchMock.mock.calls.at(-1)![1] as RequestInit;
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native login', () => {
  it('takes the tokens out of the verify response and stores them', async () => {
    const { api, tokens } = await load();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, SESSION_WITH_TOKENS)),
    );

    await api.post(VERIFY, { phone: '0812', code: '000000' });

    expect(tokens.getAccessToken()).toBe('AT-1');
    expect(tokens.getRefreshToken()).toBe('RT-1');
    expect(tokens.hasTokens()).toBe(true);
  });

  it('survives a reload — the stored tokens are read back from scratch', async () => {
    const first = await load();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, SESSION_WITH_TOKENS)),
    );
    await first.api.post(VERIFY, {});
    expect(first.vault.value).toContain('RT-1');

    // Same vault contents, brand-new module graph: exactly what a WebView restart looks
    // like. Nothing is in memory until the unlock, which is the F3b change — a Keystore
    // entry cannot be read synchronously the way localStorage could.
    vi.resetModules();
    const reloaded = await import('@/lib/token-store');
    expect(reloaded.getAccessToken()).toBeNull();
    await reloaded.unlockTokens();
    expect(reloaded.getAccessToken()).toBe('AT-1');
  });

  it('ignores a response that carries no tokens', async () => {
    const { api, tokens } = await load();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { customer: { id: 'c1' } })),
    );

    await api.post(VERIFY, {});
    expect(tokens.hasTokens()).toBe(false);
  });
});

describe('native requests', () => {
  /**
   * The cold-start race F3b would otherwise have introduced. Reading the Keystore is
   * asynchronous and can sit behind a biometric prompt, while `/driver` fires four
   * authenticated requests the instant it renders — all of which used to find a token
   * synchronously in localStorage. Without the wait in `request()` they leave bare, 401,
   * find nothing to refresh with, and the courier's home screen opens on four errors.
   */
  it('waits for the Keystore before sending an authenticated request', async () => {
    const { api, vault } = await load('{"accessToken":"AT-1","refreshToken":"RT-1"}');
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    expect(vault.value).toContain('AT-1');

    // Nothing has unlocked yet — exactly the state a page's first render is in.
    await api.get(ME, true);

    expect(headerOf(lastInit(fetchMock), 'Authorization')).toBe('Bearer AT-1');
  });

  it('does not wait, or unlock, for a public request', async () => {
    const { api, tokens } = await load('{"accessToken":"AT-1","refreshToken":"RT-1"}');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { ok: true })),
    );

    await api.get('/products/api/v1/products');

    // A public GET must not be the thing that raises a biometric prompt.
    expect(tokens.hasTokens()).toBe(false);
  });

  it('carries the access token as a bearer', async () => {
    const { api, tokens } = await load();
    tokens.primeTokens({ accessToken: 'AT-1', refreshToken: 'RT-1' });
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get(ME, true);
    expect(headerOf(lastInit(fetchMock), 'Authorization')).toBe('Bearer AT-1');
  });

  it('sends no Authorization header when it holds no token', async () => {
    const { api } = await load();
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/products/api/v1/products');
    expect(headerOf(lastInit(fetchMock), 'Authorization')).toBeUndefined();
  });

  it('keeps an explicit per-call header — the bearer never overwrites Idempotency-Key', async () => {
    const { api, tokens } = await load();
    tokens.primeTokens({ accessToken: 'AT-1', refreshToken: 'RT-1' });
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/orders/api/v1/orders', {}, true, { 'Idempotency-Key': 'K-1' });
    const init = lastInit(fetchMock);
    expect(headerOf(init, 'Idempotency-Key')).toBe('K-1');
    expect(headerOf(init, 'Authorization')).toBe('Bearer AT-1');
  });
});

describe('native refresh', () => {
  it('hands the refresh token over in the body — there is no cookie to read it from', async () => {
    const { api, tokens } = await load();
    tokens.primeTokens({ accessToken: 'STALE', refreshToken: 'RT-1' });

    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith(REFRESH)) {
        return jsonResponse(200, {
          ...SESSION_WITH_TOKENS,
          accessToken: 'AT-2',
          refreshToken: 'RT-2',
        });
      }
      // The retry only succeeds if it carried the ROTATED token, not the stale one.
      return headerOf(init, 'Authorization') === 'Bearer AT-2'
        ? jsonResponse(200, { id: 'c1' })
        : jsonResponse(401, { message: 'expired' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.get(ME, true);

    const refreshCall = fetchMock.mock.calls.find(([url]) => (url as string).endsWith(REFRESH))!;
    expect(JSON.parse((refreshCall[1] as RequestInit).body as string)).toEqual({
      refreshToken: 'RT-1',
    });
    // Rotated tokens replace the old pair, so the next call does not 401 again.
    expect(tokens.getAccessToken()).toBe('AT-2');
    expect(tokens.getRefreshToken()).toBe('RT-2');
  });

  /**
   * The reason the refresh gate reads the token store and not the cached profile.
   * Android evicts WebView localStorage under pressure; the token store (Keystore, after
   * F3b) survives it. Gating on the profile signs the user out of a live session.
   */
  it('still refreshes when the cached profile is gone but the token is not', async () => {
    const { api, tokens } = await load();
    tokens.primeTokens({ accessToken: 'STALE', refreshToken: 'RT-1' });
    // No `hm.session` in localStorage at all — the eviction this guards against.

    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith(REFRESH) ? jsonResponse(200, SESSION_WITH_TOKENS) : jsonResponse(401, {}),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.get(ME, true).catch(() => undefined);
    expect(fetchMock.mock.calls.some(([url]) => (url as string).endsWith(REFRESH))).toBe(true);
  });

  it('does not attempt a refresh when it holds no token', async () => {
    const { api } = await load();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(401, { message: 'nope' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get(ME, true)).rejects.toThrow();
    expect(fetchMock.mock.calls.some(([url]) => (url as string).endsWith(REFRESH))).toBe(false);
  });

  it('drops the tokens when the refresh itself is rejected', async () => {
    const { api, tokens, vault } = await load('{"accessToken":"STALE","refreshToken":"RT-DEAD"}');
    tokens.primeTokens({ accessToken: 'STALE', refreshToken: 'RT-DEAD' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { message: 'expired' })),
    );

    await expect(api.get(ME, true)).rejects.toThrow();
    expect(tokens.hasTokens()).toBe(false);
    // And erased from the Keystore, not merely forgotten in memory — a dead refresh
    // token that comes back on the next launch is a forced OTP for no reason.
    await tokens.tokensPersisted();
    expect(vault.value).toBeNull();
  });
});
