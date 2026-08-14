/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * E4 — push stops arriving, silently, after FCM rotates the registration token.
 *
 * `fcmToken()` tears its `registration` listener down (`offToken()`) the moment the first
 * token arrives, and nothing else was ever subscribed. But FCM rotates: app restore, clear
 * data, a Play Services refresh. It emits `registration` again, nobody is listening, and
 * the app keeps holding a `fcm:<token>` the server can no longer deliver to.
 *
 * Everything then agrees that push is fine. `nativePushState()` still answers 'subscribed'
 * because the stale endpoint is still in storage, and `requestPushOnce` short-circuits on
 * `hm.push-asked`. There is no path back — not for the user, not for us.
 *
 * So one listener stays alive for the life of the process and re-registers every new token.
 */

const post = vi.fn(async (_path: string, _body: unknown, _auth?: boolean) => ({}));
vi.mock('@/lib/api', () => ({ api: { post, get: vi.fn(), del: vi.fn() } }));

let emit: ((payload: { value?: string }) => void) | null = null;
let removed = 0;

function installBridge() {
  const stored: Record<string, string | null> = {};
  emit = null;
  removed = 0;
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      PushNotifications: {
        addListener: async (event: string, handler: (p: { value?: string }) => void) => {
          if (event === 'registration') emit = handler;
          return {
            remove: () => {
              removed++;
              emit = null;
            },
          };
        },
      },
      SecureStorage: {
        internalGetItem: async ({ prefixedKey }: { prefixedKey: string }) => {
          if (stored[prefixedKey] == null) throw Object.assign(new Error('nope'), {
            code: 'itemNotFound',
          });
          return { data: stored[prefixedKey] };
        },
        internalSetItem: async ({ prefixedKey, data }: { prefixedKey: string; data: string }) => {
          stored[prefixedKey] = data;
        },
        internalRemoveItem: async ({ prefixedKey }: { prefixedKey: string }) => {
          stored[prefixedKey] = null;
          return { success: true };
        },
      },
    },
  };
  return stored;
}

/** Let the handler's async work settle — it is fire-and-forget by design. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  post.mockClear();
  installBridge();
});

afterEach(() => {
  vi.resetModules();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('FCM token rotation', () => {
  it('re-registers the device when FCM hands over a second, different token', async () => {
    const { startPushTokenSync } = await import('@/lib/push');
    startPushTokenSync();

    emit?.({ value: 'TOKEN-1' });
    await settle();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[1]).toEqual({ endpoint: 'fcm:TOKEN-1' });

    // The rotation. Before this fix nothing was listening and this event went nowhere.
    emit?.({ value: 'TOKEN-2' });
    await settle();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]?.[1]).toEqual({ endpoint: 'fcm:TOKEN-2' });
    // The listener has to OUTLIVE the first token — that is the whole bug. `removed` was
    // counted and never read, so a teardown that unsubscribed after one registration would
    // have passed every assertion above.
    expect(removed).toBe(0);
  });

  it('does not re-post the same token twice', async () => {
    const { startPushTokenSync } = await import('@/lib/push');
    startPushTokenSync();
    emit?.({ value: 'TOKEN-1' });
    await settle();
    emit?.({ value: 'TOKEN-1' });
    await settle();
    expect(post, 'every foreground resume must not cost a POST').toHaveBeenCalledTimes(1);
  });

  it('keeps the old endpoint when the re-registration POST fails, so it retries', async () => {
    const { startPushTokenSync, nativeEndpoint } = await import('@/lib/push');
    startPushTokenSync();
    emit?.({ value: 'TOKEN-1' });
    await settle();

    post.mockRejectedValueOnce(new Error('gateway down'));
    emit?.({ value: 'TOKEN-2' });
    await settle();
    expect(await nativeEndpoint()).toBe('fcm:TOKEN-1');

    // Next event succeeds and the new token lands.
    emit?.({ value: 'TOKEN-2' });
    await settle();
    expect(await nativeEndpoint()).toBe('fcm:TOKEN-2');
  });

  it('survives the endpoint store being unreadable', async () => {
    const { startPushTokenSync } = await import('@/lib/push');
    delete (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
      ?.Plugins?.SecureStorage;
    startPushTokenSync();
    emit?.({ value: 'TOKEN-1' });
    await settle();
    // Cannot remember it, so it re-registers — the wrong answer here is to give up.
    expect(post).toHaveBeenCalledTimes(1);
  });
});
