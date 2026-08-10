/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A backgrounded Android app is frozen: no timers, no events, and everything it believed
 * when it was frozen is what it still believes when the user comes back — a delivery list
 * from forty minutes ago, and a session unlocked before lunch. These are the two things
 * that now happen on the way back in.
 */

const STORED = JSON.stringify({ accessToken: 'AT-1', refreshToken: 'RT-1' });

function installBridge(stored: string | null) {
  const entries: Record<string, string | null> = { hydromart_session: stored };
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
      // No screen lock: unlocking resolves without a prompt, which keeps this file about
      // the lifecycle rather than about biometry.
      BiometricAuthNative: {
        checkBiometry: async () => ({ isAvailable: false, deviceIsSecure: false }),
      },
    },
  };
  return entries;
}

/** Leave the app for `awayMs`, then come back. */
function goAwayFor(awayMs: number) {
  const start = Date.now();
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  vi.setSystemTime(start + awayMs);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-10T08:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('re-locking a session left open', () => {
  it('puts the session back behind the lock after a long absence', async () => {
    const entries = installBridge(STORED);
    vi.resetModules();
    const store = await import('@/lib/token-store');
    await store.unlockTokens();
    expect(store.hasTokens()).toBe(true);

    goAwayFor(16 * 60_000);

    expect(store.hasTokens()).toBe(false);
    // Re-locking is "prove it is still you", not "sign in again": wiping the vault here
    // would cost an OTP and defeat the point.
    expect(entries.hydromart_session).toBe(STORED);
    await store.unlockTokens();
    expect(store.hasTokens()).toBe(true);
  });

  it('leaves a short absence alone', async () => {
    installBridge(STORED);
    vi.resetModules();
    const store = await import('@/lib/token-store');
    await store.unlockTokens();

    goAwayFor(60_000);

    expect(store.hasTokens()).toBe(true);
  });
});

describe('refreshing a screen that went stale while the app was away', () => {
  async function mountCounter() {
    vi.resetModules();
    const { useAsync } = await import('@/lib/use-async');
    let calls = 0;
    function Screen() {
      const { data } = useAsync(async () => ++calls, []);
      return <span data-testid="n">{data ?? 0}</span>;
    }
    render(<Screen />);
    await vi.waitFor(() => expect(screen.getByTestId('n').textContent).toBe('1'));
    return () => screen.getByTestId('n').textContent;
  }

  it('asks the server again after a minute away', async () => {
    const value = await mountCounter();

    goAwayFor(90_000);

    await vi.waitFor(() => expect(value()).toBe('2'));
  });

  // Otherwise every alt-tab on a desktop turns into a round of requests from every hook
  // on the page.
  it('does not refetch on a glance away', async () => {
    const value = await mountCounter();

    goAwayFor(5_000);

    await vi.advanceTimersByTimeAsync(50);
    expect(value()).toBe('1');
  });
});
