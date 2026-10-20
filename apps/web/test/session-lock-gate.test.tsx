/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The half of the Ops 1.14.0 "Missing bearer token" failure that lives in the UI: every screen
 * is drawn from the profile cached in localStorage, so a session that was on the device but not
 * open still looked signed in. These run the real provider, the real token store and the real
 * API client against a fake Keystore and a fake gateway.
 */

// The lock screen is a lazily loaded chunk, so the first `findBy` also waits for its import.
const SLOW = { timeout: 15_000 };

// The first case pays for importing the whole provider tree (about 5 s on a cold CI runner).
vi.setConfig({ testTimeout: 30_000 });

const STORED = JSON.stringify({ accessToken: 'AT-1', refreshToken: 'RT-1' });
const CUSTOMER = { id: 'c1', role: 'STAFF_DEPOT', fullName: 'Aril', phone: '+62811' };

type Prompt = 'ok' | 'cancel';

function installDevice(stored: string | null, prompts: Prompt[]) {
  const entries: Record<string, string | null> = { hydromart_session: stored };
  const queue = [...prompts];
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
          if ((queue.shift() ?? 'ok') === 'cancel') {
            throw Object.assign(new Error('c'), { code: 'userCancel' });
          }
        },
      },
    },
  };
  return entries;
}

const sent: { url: string; auth: string | null }[] = [];
const attached: EventListener[] = [];
const realAdd = document.addEventListener.bind(document);
let mounts = 0;

beforeEach(() => {
  sent.length = 0;
  attached.length = 0;
  mounts = 0;
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
      if (!auth) return new Response('{"message":"Missing bearer token."}', { status: 401 });
      return new Response(JSON.stringify(CUSTOMER), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  for (const fn of attached) document.removeEventListener('visibilitychange', fn);
  document.addEventListener = realAdd;
});

async function mountApp(cached: boolean, profile: object = CUSTOMER) {
  vi.resetModules();
  const { LocaleProvider } = await import('@/lib/locale-context');
  const { AuthProvider, useAuth } = await import('@/lib/auth-context');
  const { setSession } = await import('@/lib/session-store');
  const { api } = await import('@/lib/api');
  if (cached) setSession({ customer: profile } as never);

  function Probe() {
    const { customer, ready } = useAuth();
    // Counts how many times the subtree under the provider was (re)created.
    useEffect(() => {
      mounts += 1;
      // What every real screen does on mount.
      void api.get('/ping', true).catch(() => {});
    }, []);
    return (
      <p data-testid="probe">
        {ready ? (customer ? `signed-in:${customer.fullName}` : 'signed-out') : 'booting'}
      </p>
    );
  }

  render(
    <LocaleProvider>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </LocaleProvider>,
  );
  return { setSession };
}

describe('a locked session is never drawn as a signed-in app', () => {
  it('a dismissed prompt covers the screen with the lock gate instead of failing every widget', async () => {
    installDevice(STORED, ['cancel']);
    await mountApp(true);

    const dialog = await screen.findByRole('dialog', {}, SLOW);
    expect(dialog.textContent).toMatch(/Sesi terkunci/);
    // The screen underneath asked for data on mount, and that was refused on the device:
    // nothing went out bare while the gate was up.
    expect(sent.filter((s) => s.auth === null)).toHaveLength(0);
  });

  it('opening it removes the gate, reloads what is underneath and sends the bearer', async () => {
    installDevice(STORED, ['cancel', 'ok']);
    await mountApp(true);
    await screen.findByRole('dialog', {}, SLOW);
    const before = mounts;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Buka sesi/i }));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mounts).toBeGreaterThan(before); // remounted, so error states are gone
    await waitFor(() => expect(sent.some((s) => s.url.endsWith('/ping') && s.auth === 'Bearer AT-1')).toBe(true));
    expect(screen.getByTestId('probe').textContent).toMatch(/signed-in:Aril/);
  });

  it('a second dismissal keeps the gate up and says so', async () => {
    installDevice(STORED, ['cancel', 'cancel']);
    await mountApp(true);
    await screen.findByRole('dialog', {}, SLOW);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Buka sesi/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Belum terbuka/));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('"masuk dengan kode SMS" gives the session up: gate gone, profile gone, vault empty', async () => {
    const vault = installDevice(STORED, ['cancel']);
    await mountApp(true);
    await screen.findByRole('dialog', {}, SLOW);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /kode SMS/i }));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('probe').textContent).toMatch(/signed-out/);
    await waitFor(() => expect(vault.hydromart_session).toBeNull());
  });

  it('the profile was evicted but the token survived: opening the lock rebuilds it', async () => {
    installDevice(STORED, ['cancel', 'ok']);
    await mountApp(false);
    await screen.findByRole('dialog', {}, SLOW);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Buka sesi/i }));
    });

    await waitFor(() =>
      expect(screen.getByTestId('probe').textContent).toMatch(/signed-in:Aril/),
    );
  });
});

describe('a shopper may carry on as a guest', () => {
  const SHOPPER = { ...CUSTOMER, id: 'c2', role: 'CUSTOMER', fullName: 'Sari' };

  it('offers it to a customer, and taking it clears the profile but keeps the stored session', async () => {
    const vault = installDevice(STORED, ['cancel']);
    await mountApp(true, SHOPPER);
    await screen.findByRole('dialog', {}, SLOW);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Lanjut tanpa masuk/i }));
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('probe').textContent).toMatch(/signed-out/);
    // Still there for the login page's "Buka sesi tersimpan", and nothing went out bare.
    expect(vault.hydromart_session).toBe(STORED);
    expect(sent.filter((x) => x.auth === null)).toHaveLength(0);
  });

  it('offers it when the profile was evicted, since there is nothing to hide', async () => {
    installDevice(STORED, ['cancel']);
    await mountApp(false);
    await screen.findByRole('dialog', {}, SLOW);

    expect(screen.getByRole('button', { name: /Lanjut tanpa masuk/i })).toBeTruthy();
  });

  it('does not offer it to staff: every screen they have needs the session', async () => {
    installDevice(STORED, ['cancel']);
    await mountApp(true); // STAFF_DEPOT
    await screen.findByRole('dialog', {}, SLOW);

    expect(screen.queryByRole('button', { name: /Lanjut tanpa masuk/i })).toBeNull();
  });
});

describe('a stale profile with nothing behind it', () => {
  it('an empty Keystore drops the cached profile so the app asks for a sign-in', async () => {
    installDevice(null, []);
    await mountApp(true);

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/signed-out/));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the web', () => {
  it('has no gate and keeps its cookie session untouched', async () => {
    vi.doMock('@/lib/platform', () => ({ isNativeShell: () => false }));
    // The browser's cookie rides on the request itself; the fake gateway accepts it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(CUSTOMER), { status: 200 })),
    );
    installDevice(null, []);
    await mountApp(true);

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/signed-in/));
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.doUnmock('@/lib/platform');
  });
});
