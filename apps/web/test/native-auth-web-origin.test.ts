/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://app.hydromart.id/" }
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// The other half of F2, and the half that must never regress: on an ordinary browser
// origin the native path does not exist. Same code, same responses — no token is stored,
// no Authorization header is sent, and the httpOnly cookie session SEC-4 built is what
// still carries auth. A separate file because the origin is a property of the document,
// which is fixed for the life of the environment.

describe('web origin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('stores no token, even from a response that carries one', async () => {
    vi.resetModules();
    const { api } = await import('@/lib/api');
    const tokens = await import('@/lib/token-store');
    // A vault that would answer if anything asked it to. Nothing on this origin should.
    const vault = { value: null as string | null };
    (window as unknown as { Capacitor: unknown }).Capacitor = {
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
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ accessToken: 'AT-1', refreshToken: 'RT-1', customer: { id: 'c1' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    await api.post('/auth/api/v1/auth/otp/verify', {});

    expect(tokens.hasTokens()).toBe(false);
    // Not in the Keystore either — the web branch never reaches the vault at all, which
    // is what keeps a browser's session in the httpOnly cookie SEC-4 built for it.
    await tokens.tokensPersisted();
    expect(vault.value).toBeNull();
  });

  it('sends no Authorization header, and refuses to write one even if asked to', async () => {
    vi.resetModules();
    const { api } = await import('@/lib/api');
    const tokens = await import('@/lib/token-store');
    // Even an explicit write is dropped on the web — there is exactly one place a token
    // can live in a browser, and it is not reachable from JavaScript.
    tokens.setTokens({ accessToken: 'AT-1', refreshToken: 'RT-1' });

    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/auth/api/v1/auth/me', true);

    const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.credentials).toBe('include');
  });
});
