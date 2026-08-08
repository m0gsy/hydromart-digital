/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F3b. The rules that must not be left to the plugin's defaults, each one proved here
 * rather than on a phone: a device with no lock is not locked out, a cancelled prompt
 * destroys nothing, and three real mismatches destroy everything.
 */

const STORED = JSON.stringify({ accessToken: 'AT-1', refreshToken: 'RT-1' });

interface Biometry {
  isAvailable?: boolean;
  deviceIsSecure?: boolean;
}

/** Rejection shape Capacitor gives a JS caller when a native plugin call fails. */
function pluginError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function install(options: {
  stored?: string | null;
  biometry?: Biometry | null;
  /** Codes the prompt rejects with, in order; `undefined` means it succeeds. */
  outcomes?: (string | undefined)[];
}) {
  const vault = { value: options.stored ?? null };
  const prompts: number[] = [];
  const outcomes = options.outcomes ?? [];
  const biometry = options.biometry === undefined ? { isAvailable: true } : options.biometry;

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
      BiometricAuthNative: biometry
        ? {
            checkBiometry: async () => biometry,
            internalAuthenticate: async () => {
              const code = outcomes[prompts.length];
              prompts.push(1);
              if (code) throw pluginError(code);
            },
          }
        : undefined,
    },
  };
  return { vault, promptCount: () => prompts.length };
}

async function loadStore() {
  vi.resetModules();
  return import('@/lib/token-store');
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('unlockTokens', () => {
  it('restores the session once the owner has proved it', async () => {
    const { promptCount } = install({ stored: STORED });
    const store = await loadStore();

    await store.unlockTokens();

    expect(promptCount()).toBe(1);
    expect(store.getRefreshToken()).toBe('RT-1');
  });

  it('does not prompt when there is nothing stored to unlock', async () => {
    const { promptCount } = install({ stored: null });
    const store = await loadStore();

    await store.unlockTokens();

    expect(promptCount()).toBe(0);
    expect(store.hasTokens()).toBe(false);
  });

  it('restores without a prompt on a device with no screen lock at all', async () => {
    // The deliberate call: refusing here would lock a user out of an app that kept them
    // signed in yesterday, to protect a secret on a phone anyone can already open.
    const { promptCount } = install({
      stored: STORED,
      biometry: { isAvailable: false, deviceIsSecure: false },
    });
    const store = await loadStore();

    await store.unlockTokens();

    expect(promptCount()).toBe(0);
    expect(store.hasTokens()).toBe(true);
  });

  it('treats a missing plugin as no lock rather than as a locked-out user', async () => {
    const { vault } = install({ stored: STORED, biometry: null });
    const store = await loadStore();

    await store.unlockTokens();

    expect(store.hasTokens()).toBe(true);
    expect(vault.value).toBe(STORED);
  });

  it('keeps the vault when the prompt is dismissed, and stays signed out', async () => {
    const { vault } = install({ stored: STORED, outcomes: ['userCancel'] });
    const store = await loadStore();

    await store.unlockTokens();

    expect(store.hasTokens()).toBe(false);
    expect(vault.value).toBe(STORED);
  });

  it('never counts a dismissal towards the wipe, however many times it happens', async () => {
    const { vault } = install({
      stored: STORED,
      outcomes: ['userCancel', 'userCancel', 'userCancel', 'userCancel'],
    });

    for (let i = 0; i < 4; i++) {
      const store = await loadStore();
      await store.unlockTokens();
    }

    expect(vault.value).toBe(STORED);
  });

  it('wipes the stored session after three real mismatches, across restarts', async () => {
    const { vault } = install({
      stored: STORED,
      outcomes: ['authenticationFailed', 'authenticationFailed', 'biometryLockout'],
    });

    // A fresh module graph each time: the counter has to survive the app being killed
    // between attempts, or picking the phone up again resets it to zero.
    for (let i = 0; i < 3; i++) {
      const store = await loadStore();
      await store.unlockTokens();
      expect(store.hasTokens()).toBe(false);
    }

    expect(vault.value).toBeNull();
  });

  it('forgets earlier failures once the owner gets in', async () => {
    const { vault } = install({
      stored: STORED,
      outcomes: ['authenticationFailed', 'authenticationFailed', undefined, 'authenticationFailed'],
    });

    for (let i = 0; i < 4; i++) {
      const store = await loadStore();
      await store.unlockTokens();
    }

    // Two fails, a success, then one more fail is not three consecutive fails.
    expect(vault.value).toBe(STORED);
  });

  it('unlocks nothing and prompts for nothing on the web', async () => {
    const { promptCount } = install({ stored: STORED });
    // The one thing every native path is gated on: the WebView origin.
    vi.stubGlobal('location', { origin: 'https://hydromart.example' });
    const store = await loadStore();

    await store.unlockTokens();

    expect(promptCount()).toBe(0);
    expect(store.hasTokens()).toBe(false);
    vi.unstubAllGlobals();
  });
});
