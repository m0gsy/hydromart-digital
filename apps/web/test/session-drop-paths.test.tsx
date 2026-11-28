/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Every place the app drops a session the server still holds leaves a marker, so the next billed
 * SMS can be explained. Run against the real token store, API client and auth provider with a
 * fake Keystore.
 */
vi.setConfig({ testTimeout: 30_000 });

const STORED = JSON.stringify({ accessToken: 'AT-1', refreshToken: 'RT-1' });

type Prompt = 'ok' | 'fail';

function install(opts: {
  stored: string | null;
  prompts?: Prompt[];
  /** One entry per read: true = reject. Past the end, reads succeed. */
  readFails?: boolean[];
  /** One entry per session write: true = reject. */
  writeFails?: boolean[];
}) {
  const entries: Record<string, string | null> = { hydromart_session: opts.stored };
  const reads = [...(opts.readFails ?? [])];
  const writes = [...(opts.writeFails ?? [])];
  const prompts = [...(opts.prompts ?? [])];
  const calls = { reads: 0, writes: 0 };
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      SecureStorage: {
        internalGetItem: async ({ prefixedKey }: { prefixedKey: string }) => {
          if (prefixedKey === 'hydromart_session') {
            calls.reads += 1;
            if (reads.shift()) throw Object.assign(new Error('r'), { code: 'keystoreBusy' });
          }
          return { data: entries[prefixedKey] ?? null };
        },
        internalSetItem: async ({ prefixedKey, data }: { prefixedKey: string; data: string }) => {
          if (prefixedKey === 'hydromart_session') {
            calls.writes += 1;
            if (writes.shift()) throw Object.assign(new Error('w'), { code: 'keystoreBusy' });
          }
          entries[prefixedKey] = data;
        },
        internalRemoveItem: async ({ prefixedKey }: { prefixedKey: string }) => {
          entries[prefixedKey] = null;
          return { success: true };
        },
      },
      BiometricAuthNative: {
        checkBiometry: async () => ({ isAvailable: true }),
        internalAuthenticate: async () => {
          if ((prompts.shift() ?? 'ok') === 'fail') {
            throw Object.assign(new Error('f'), { code: 'authenticationFailed' });
          }
        },
      },
    },
  };
  return { entries, calls };
}

const attached: EventListener[] = [];
const realAdd = document.addEventListener.bind(document);
const marker = () => localStorage.getItem('hm_session_drop');

beforeEach(() => {
  attached.length = 0;
  localStorage.clear();
  document.addEventListener = ((type: string, fn: EventListener, o?: unknown) => {
    if (type === 'visibilitychange') attached.push(fn);
    return realAdd(type, fn, o as AddEventListenerOptions);
  }) as typeof document.addEventListener;
});
afterEach(() => {
  cleanup();
  for (const fn of attached) document.removeEventListener('visibilitychange', fn);
  document.addEventListener = realAdd;
  vi.unstubAllGlobals();
});

async function load() {
  vi.resetModules();
  const store = await import('@/lib/token-store');
  const api = await import('@/lib/api');
  return { ...store, ...api };
}

describe('vault read', () => {
  it('a read that fails once is retried and the session opens, with no marker', async () => {
    const dev = install({ stored: STORED, readFails: [true] });
    const { unlockTokens, getAccessToken } = await load();
    await unlockTokens();
    expect(dev.calls.reads).toBe(2);
    expect(getAccessToken()).toBe('AT-1');
    expect(marker()).toBeNull();
  });

  it('a read that still fails after the retry destroys the entry and says why', async () => {
    const dev = install({ stored: STORED, readFails: [true, true] });
    const { unlockTokens, getSessionLock } = await load();
    await unlockTokens();
    expect(dev.calls.reads).toBe(2);
    expect(dev.entries.hydromart_session).toBeNull();
    expect(getSessionLock()).toBe('signedOut');
    expect(marker()).toBe('vault_read_failed');
  });

  it('an empty Keystore on a phone that had a session is vault_empty', async () => {
    localStorage.setItem('hm_had_session', '1');
    install({ stored: null });
    const { unlockTokens } = await load();
    await unlockTokens();
    expect(marker()).toBe('vault_empty');
  });

  it('an empty Keystore on a first run leaves no marker, and never overwrites a known reason', async () => {
    install({ stored: null });
    await (await load()).unlockTokens();
    expect(marker()).toBeNull();

    localStorage.setItem('hm_had_session', '1');
    localStorage.setItem('hm_session_drop', 'signed_out');
    install({ stored: null });
    await (await load()).unlockTokens();
    expect(marker()).toBe('signed_out');
  });

  it('opening a stored session marks the phone as having had one', async () => {
    install({ stored: STORED });
    await (await load()).unlockTokens();
    expect(localStorage.getItem('hm_had_session')).toBe('1');
  });
});

describe('unlock', () => {
  it('the third failed unlock wipes the session and says so; the first two do not', async () => {
    const dev = install({ stored: STORED, prompts: ['fail', 'fail', 'fail'] });
    const { unlockTokens, retryUnlock } = await load();
    await unlockTokens();
    expect(marker()).toBeNull();
    await retryUnlock();
    expect(marker()).toBeNull();
    await retryUnlock();
    expect(dev.entries.hydromart_session).toBeNull();
    expect(marker()).toBe('unlock_failed');
  });
});

describe('vault write', () => {
  it('a write that fails once is retried: it lands and leaves no marker', async () => {
    const dev = install({ stored: null, writeFails: [true] });
    const { setTokens, tokensPersisted } = await load();
    setTokens({ accessToken: 'A', refreshToken: 'R' });
    await tokensPersisted();
    expect(dev.calls.writes).toBe(2);
    expect(dev.entries.hydromart_session).toContain('"R"');
    expect(marker()).toBeNull();
  });

  it('a write that still fails keeps the session in memory and says it was not stored', async () => {
    const dev = install({ stored: null, writeFails: [true, true] });
    const { setTokens, tokensPersisted, getAccessToken } = await load();
    setTokens({ accessToken: 'A', refreshToken: 'R' });
    await tokensPersisted();
    expect(dev.calls.writes).toBe(2);
    expect(getAccessToken()).toBe('A');
    expect(marker()).toBe('vault_write_failed');
  });
});

describe('refresh', () => {
  it('a refused refresh signs the device out and says refresh_refused', async () => {
    install({ stored: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'no' }), { status: 401 })),
    );
    const { primeTokens, api, hasTokens } = await load();
    primeTokens({ accessToken: 'A', refreshToken: 'R' });
    await api.get('/x', true).catch(() => {});
    expect(hasTokens()).toBe(false);
    expect(marker()).toBe('refresh_refused');
  });

  it('an unanswered refresh (network) keeps the session and leaves no marker', async () => {
    install({ stored: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('refresh')) throw new TypeError('offline');
        return new Response('{}', { status: 401 });
      }),
    );
    const { primeTokens, api, hasTokens } = await load();
    primeTokens({ accessToken: 'A', refreshToken: 'R' });
    await api.get('/x', true).catch(() => {});
    expect(hasTokens()).toBe(true);
    expect(marker()).toBeNull();
  });
});

describe('sign out', () => {
  it('leaves signed_out', async () => {
    install({ stored: STORED });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    vi.resetModules();
    const { LocaleProvider } = await import('@/lib/locale-context');
    const { AuthProvider, useAuth } = await import('@/lib/auth-context');
    const { hasTokens } = await import('@/lib/token-store');
    let out: () => void = () => {};
    function Probe() {
      const { signOut, ready } = useAuth();
      out = signOut;
      return <p data-testid="p">{ready ? 'ready' : 'booting'}</p>;
    }
    render(
      <LocaleProvider>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </LocaleProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('ready'), {
      timeout: 20_000,
    });
    await waitFor(() => expect(hasTokens()).toBe(true));
    act(() => out());
    expect(marker()).toBe('signed_out');
    expect(hasTokens()).toBe(false);
  });
});
