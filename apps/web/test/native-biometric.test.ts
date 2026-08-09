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
  // Keyed, because the vault holds two entries now: the session and the failure counter.
  // A mock with one slot let `setFailures(0)` delete the session, which is a bug the
  // harness invented rather than one the code has.
  const entries: Record<string, string | null> = { hydromart_session: options.stored ?? null };
  const vault = {
    get value() {
      return entries.hydromart_session ?? null;
    },
    set value(next: string | null) {
      entries.hydromart_session = next;
    },
  };
  const prompts: number[] = [];
  const outcomes = options.outcomes ?? [];
  const biometry = options.biometry === undefined ? { isAvailable: true } : options.biometry;

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

  it('prompts once however many callers ask, and never again after it has answered', async () => {
    const { promptCount } = install({ stored: STORED });
    const store = await loadStore();

    await Promise.all([store.unlockTokens(), store.unlockTokens(), store.unlockTokens()]);
    await store.unlockTokens();

    expect(promptCount()).toBe(1);
  });

  it('does not prompt to re-open a session that was just opened by OTP', async () => {
    const { promptCount } = install({ stored: STORED });
    const store = await loadStore();
    // What `captureTokens` does on a verify response, before anything has unlocked.
    store.primeTokens({ accessToken: 'AT-NEW', refreshToken: 'RT-NEW' });

    await store.unlockTokens();

    expect(promptCount()).toBe(0);
    expect(store.getAccessToken()).toBe('AT-NEW');
  });

  /**
   * A dismissal has always been survivable by design — but `unlocking` is remembered for
   * the life of the process, so the only way to ask again used to be killing the app. One
   * stray back-press therefore cost an OTP, which is the outcome the design says it exists
   * to prevent.
   */
  it('can ask again after the prompt was dismissed', async () => {
    const { vault, promptCount } = install({ stored: STORED, outcomes: ['userCancel', undefined] });
    const store = await loadStore();

    await store.unlockTokens();
    expect(store.hasTokens()).toBe(false);
    expect(store.unlockWasCancelled()).toBe(true);
    expect(vault.value).toBe(STORED); // dismissing destroyed nothing

    await store.retryUnlock();

    expect(promptCount()).toBe(2);
    expect(store.getRefreshToken()).toBe('RT-1');
    expect(store.unlockWasCancelled()).toBe(false);
  });

  it('does not offer a retry when nothing was dismissed', async () => {
    install({ stored: STORED, outcomes: ['authenticationFailed'] });
    const store = await loadStore();

    await store.unlockTokens();

    // A real mismatch counts towards the wipe; offering "try again" for it would be the
    // bypass the whole design refuses.
    expect(store.unlockWasCancelled()).toBe(false);
  });

  /**
   * Android invalidates a Keystore key when a new fingerprint is enrolled. The blob is
   * then undecryptable forever, and treating that as "nothing stored" leaves it on disk
   * raising a prompt on every launch for something that can never open.
   */
  it('clears an entry the device can no longer decrypt', async () => {
    const { vault } = install({ stored: STORED });
    (
      window as unknown as { Capacitor: { Plugins: { SecureStorage: Record<string, unknown> } } }
    ).Capacitor.Plugins.SecureStorage.internalGetItem = async () => {
      throw Object.assign(new Error('keyInvalidated'), { code: 'keyInvalidated' });
    };
    const store = await loadStore();

    await store.unlockTokens();

    expect(store.hasTokens()).toBe(false);
    expect(vault.value).toBeNull();
  });

  it('keeps the entry when the plugin is simply not there', async () => {
    const { vault } = install({ stored: STORED });
    (
      window as unknown as { Capacitor: { Plugins: Record<string, unknown> } }
    ).Capacitor.Plugins.SecureStorage = {};
    const store = await loadStore();

    await store.unlockTokens();

    // 'unavailable' is a build problem, not a broken key — destroying a good session over
    // it would turn a missing plugin into a mass sign-out.
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
