/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Missing bearer token" on every screen of Ops 1.14.0, 2026-10-20.
 *
 * Production logs showed 317 requests from the Ops app reaching the services with no
 * `Authorization` header, in bursts of four to six a second — one screen's worth of widgets —
 * ending the moment the app was reopened. The cause was a session that was on the device but
 * not open: a prompt dismissed after 15 minutes in the background left the token store empty
 * while the cached profile still said "signed in", so every screen rendered, every request left
 * bare, and nothing offered a way back.
 *
 * Each case below failed against that code. The gateway here answers what the real guard
 * answers: 401 "Missing bearer token." whenever there is no `Authorization` header.
 */

const STORED = JSON.stringify({ accessToken: 'AT-1', refreshToken: 'RT-1' });

type Prompt = 'ok' | 'cancel' | 'fail';

function install(opts: { stored: string | null; prompt: Prompt | Prompt[] }) {
  const entries: Record<string, string | null> = { hydromart_session: opts.stored };
  const queue = Array.isArray(opts.prompt) ? [...opts.prompt] : null;
  let prompts = 0;
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      SecureStorage: {
        internalGetItem: async ({ prefixedKey }: { prefixedKey: string }) => ({
          data: entries[prefixedKey] ?? null,
        }),
        internalSetItem: async ({ prefixedKey, data }: { prefixedKey: string; data: string }) => {
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
          prompts += 1;
          const next = queue ? (queue.shift() ?? 'ok') : (opts.prompt as Prompt);
          if (next === 'cancel') throw Object.assign(new Error('c'), { code: 'userCancel' });
          if (next === 'fail') throw Object.assign(new Error('f'), { code: 'authenticationFailed' });
        },
      },
    },
  };
  return { entries, prompts: () => prompts };
}

const sent: { url: string; auth: string | null }[] = [];

// `app-lifecycle` registers a `visibilitychange` listener at import, and every `resetModules()`
// imports a fresh copy. Left attached, the copy from the PREVIOUS test answers this test's
// "app came back" event too and raises prompts nobody in this test asked for.
const attached: EventListener[] = [];
const realAdd = document.addEventListener.bind(document);

beforeEach(() => {
  sent.length = 0;
  attached.length = 0;
  localStorage.clear();
  document.addEventListener = ((type: string, fn: EventListener, o?: unknown) => {
    if (type === 'visibilitychange') attached.push(fn);
    return realAdd(type, fn, o as AddEventListenerOptions);
  }) as typeof document.addEventListener;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? null;
      sent.push({ url, auth });
      return auth
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify({ message: 'Missing bearer token.' }), { status: 401 });
    }),
  );
});

afterEach(() => {
  for (const fn of attached) document.removeEventListener('visibilitychange', fn);
  document.addEventListener = realAdd;
  vi.doUnmock('@/lib/platform');
});

async function load() {
  vi.resetModules();
  const api = await import('@/lib/api');
  const store = await import('@/lib/token-store');
  return { ...api, ...store };
}

function goBackground(minutes: number) {
  const vis = (v: string) => {
    Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  vis('hidden');
  vi.setSystemTime(Date.now() + minutes * 60_000);
  return () => vis('visible');
}

describe('a session that is on the device but not open', () => {
  it('a dismissed prompt is `locked`, and no request leaves the device', async () => {
    install({ stored: STORED, prompt: 'cancel' });
    const { api, getSessionLock, SESSION_LOCKED_CODE } = await load();

    await expect(api.get('/x', true)).rejects.toMatchObject({
      status: 401,
      code: SESSION_LOCKED_CODE,
    });
    expect(getSessionLock()).toBe('locked');
    expect(sent).toHaveLength(0);
  });

  it('stays locked for every later request instead of going out bare', async () => {
    install({ stored: STORED, prompt: 'cancel' });
    const { api } = await load();

    await api.get('/a', true).catch(() => {});
    await api.get('/b', true).catch(() => {});
    await api.post('/c', {}, true).catch(() => {});

    expect(sent).toHaveLength(0);
  });

  it('opening it from the lock screen restores the bearer on the next request', async () => {
    const dev = install({ stored: STORED, prompt: ['cancel', 'ok'] });
    const { api, retryUnlock, getSessionLock } = await load();
    await api.get('/a', true).catch(() => {});
    expect(getSessionLock()).toBe('locked');

    await retryUnlock();

    expect(getSessionLock()).toBe('open');
    expect(dev.prompts()).toBe(2);
    await api.get('/b', true);
    expect(sent.map((s) => s.auth)).toEqual(['Bearer AT-1']);
  });

  it('a failed (not dismissed) unlock below the limit is locked, not signed out', async () => {
    const dev = install({ stored: STORED, prompt: 'fail' });
    const { api, getSessionLock } = await load();

    await api.get('/x', true).catch(() => {});

    expect(getSessionLock()).toBe('locked');
    expect(dev.entries.hydromart_session).toBe(STORED);
  });

  it('three failed unlocks destroy the vault and the state becomes signedOut', async () => {
    const dev = install({ stored: STORED, prompt: 'fail' });
    const { api, getSessionLock, retryUnlock } = await load();
    await api.get('/x', true).catch(() => {});
    await retryUnlock();
    await retryUnlock();

    expect(getSessionLock()).toBe('signedOut');
    expect(dev.entries.hydromart_session).toBeNull();
  });

  it('four requests at once raise one prompt, not four', async () => {
    const dev = install({ stored: STORED, prompt: 'cancel' });
    const { api } = await load();

    await Promise.allSettled([
      api.get('/1', true),
      api.get('/2', true),
      api.get('/3', true),
      api.get('/4', true),
    ]);

    expect(dev.prompts()).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('listeners hear each change once, and only changes', async () => {
    install({ stored: STORED, prompt: ['cancel', 'ok'] });
    const { api, retryUnlock, onSessionLockChange } = await load();
    const seen: string[] = [];
    onSessionLockChange((s) => seen.push(s));

    await api.get('/a', true).catch(() => {});
    await retryUnlock();

    expect(seen).toEqual(['locked', 'pending', 'open']);
  });
});

describe('no session at all', () => {
  it('an empty vault is signedOut, so a stale cached profile can be dropped', async () => {
    install({ stored: null, prompt: 'ok' });
    const { api, getSessionLock } = await load();

    await api.get('/x', true).catch(() => {});

    expect(getSessionLock()).toBe('signedOut');
  });

  it('an entry that opens but holds nothing usable is signedOut, not a prompt that cannot succeed', async () => {
    install({ stored: '{"nope":1}', prompt: 'ok' });
    const { api, getSessionLock } = await load();

    await api.get('/x', true).catch(() => {});

    expect(getSessionLock()).toBe('signedOut');
  });

  it('the web has nothing to lock', async () => {
    // The shell is recognised by origin as well as by the bridge, so say "browser" directly.
    vi.doMock('@/lib/platform', () => ({ isNativeShell: () => false }));
    const { getSessionLock } = await load();

    expect(getSessionLock()).toBe('open');
  });
});

describe('a prompt that never answers', () => {
  it('becomes locked after the timeout instead of holding every screen on a spinner', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      install({ stored: STORED, prompt: 'ok' });
      // The plugin takes the call and never replies.
      (
        window as unknown as {
          Capacitor: { Plugins: { BiometricAuthNative: { internalAuthenticate: () => Promise<never> } } };
        }
      ).Capacitor.Plugins.BiometricAuthNative.internalAuthenticate = () => new Promise<never>(() => {});
      const { api, getSessionLock } = await load();

      const pending = api.get('/x', true).catch((e) => e);
      await vi.advanceTimersByTimeAsync(89_000);
      expect(getSessionLock()).toBe('pending');

      await vi.advanceTimersByTimeAsync(2_000);
      expect(getSessionLock()).toBe('locked');
      await expect(pending).resolves.toMatchObject({ code: 'CLIENT_SESSION_LOCKED' });
      expect(sent).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a prompt answered in time never fires the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      install({ stored: STORED, prompt: 'ok' });
      const { api, getSessionLock } = await load();
      await api.get('/x', true);

      await vi.advanceTimersByTimeAsync(120_000);

      expect(getSessionLock()).toBe('open');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('files wait for the Keystore like every other request', () => {
  it('getBlob on a cold start carries the bearer once the prompt is answered', async () => {
    install({ stored: STORED, prompt: 'ok' });
    const { getBlob } = await load();

    await getBlob('/hr/payslip.pdf').catch(() => {});

    expect(sent[0]?.auth).toBe('Bearer AT-1');
  });

  it('getBlob, postBlob and uploadFile refuse on a locked session without a request', async () => {
    install({ stored: STORED, prompt: 'cancel' });
    const { getBlob, postBlob, uploadFile } = await load();

    await expect(getBlob('/a')).rejects.toMatchObject({ code: 'CLIENT_SESSION_LOCKED' });
    await expect(postBlob('/b', {})).rejects.toMatchObject({ code: 'CLIENT_SESSION_LOCKED' });
    await expect(uploadFile('/c', new Blob(['x']))).rejects.toMatchObject({
      code: 'CLIENT_SESSION_LOCKED',
    });
    expect(sent).toHaveLength(0);
  });
});

describe('coming back after a long absence', () => {
  it('asks for the unlock the moment the app returns, before any request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const dev = install({ stored: STORED, prompt: 'ok' });
      const { api } = await load();
      await api.get('/x', true);
      const comeBack = goBackground(20);
      expect(dev.prompts()).toBe(1);

      comeBack();
      await vi.waitFor(() => expect(dev.prompts()).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a dismissal there lands in locked, and nothing is sent bare afterwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      install({ stored: STORED, prompt: ['ok', 'cancel'] });
      const { api, getSessionLock } = await load();
      await api.get('/x', true);
      sent.length = 0;
      goBackground(20)();

      await vi.waitFor(() => expect(getSessionLock()).toBe('locked'));
      await api.get('/y', true).catch(() => {});
      expect(sent).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('under 15 minutes is not a relock: no prompt, same token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const dev = install({ stored: STORED, prompt: 'ok' });
      const { api, getSessionLock } = await load();
      await api.get('/x', true);

      goBackground(5)();

      expect(dev.prompts()).toBe(1);
      expect(getSessionLock()).toBe('open');
    } finally {
      vi.useRealTimers();
    }
  });
});
