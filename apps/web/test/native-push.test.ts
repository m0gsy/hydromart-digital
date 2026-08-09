/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// F4. Push inside the WebView is FCM, not Web Push — and the trap this file exists for is
// that the WebView reports `serviceWorker` and `PushManager` as present, so the browser
// path looks supported right up to the point where no notification ever arrives.

type Listener = (payload: unknown) => void;

const listeners: Record<string, Listener[]> = {};
let permission: 'granted' | 'denied' | 'prompt' = 'granted';
/** What the plugin answers with after `register()` — a token, an error, or silence. */
let registrationResult: { token?: string; error?: boolean } = { token: 'TOKEN-1' };

function emit(event: string, payload: unknown) {
  for (const handler of listeners[event] ?? []) handler(payload);
}

function installBridge() {
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    Plugins: {
      PushNotifications: {
        checkPermissions: vi.fn(async () => ({ receive: permission })),
        requestPermissions: vi.fn(async () => ({ receive: permission })),
        createChannel: vi.fn(async () => undefined),
        register: vi.fn(async () => {
          // The plugin answers asynchronously; `register()` only starts the handshake.
          queueMicrotask(() => {
            if (registrationResult.error) emit('registrationError', { error: 'no play services' });
            else if (registrationResult.token)
              emit('registration', { value: registrationResult.token });
          });
        }),
        addListener: vi.fn(async (event: string, handler: Listener) => {
          (listeners[event] ??= []).push(handler);
          return {
            remove: () => {
              listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler);
            },
          };
        }),
      },
    },
  };
}

async function load() {
  vi.resetModules();
  return import('@/lib/push');
}

const fetchMock = vi.fn(
  async (_url: string, _init: RequestInit) =>
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
);

beforeEach(() => {
  for (const key of Object.keys(listeners)) delete listeners[key];
  permission = 'granted';
  registrationResult = { token: 'TOKEN-1' };
  window.localStorage.clear();
  fetchMock.mockClear();
  installBridge();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.unstubAllGlobals();
});

describe('subscribing on Android', () => {
  it('registers the FCM token under the fcm: prefix the server routes on', async () => {
    const push = await load();
    expect(await push.subscribeToPush()).toBe('subscribed');

    const call = fetchMock.mock.calls.find(([url]) => url.includes('/push/subscriptions'))!;
    expect(JSON.parse(call[1].body as string)).toEqual({ endpoint: 'fcm:TOKEN-1' });
    // No `keys`: an Android registration has no keypair, and the DTO now allows that.
    expect(window.localStorage.getItem('hm.fcm-endpoint')).toBe('fcm:TOKEN-1');
  });

  /**
   * Android 8+ takes importance from the channel, not the message. Without one of ours,
   * every push lands in the system's "Miscellaneous" channel at default importance: no
   * heads-up, and the only control the user has is to silence the whole app. The id has
   * to match `default_notification_channel_id` in the manifest — a mismatch is silent.
   */
  it('creates the notification channel the manifest names', async () => {
    const push = await load();
    await push.subscribeToPush();

    const created = (
      window as unknown as {
        Capacitor: { Plugins: { PushNotifications: { createChannel: ReturnType<typeof vi.fn> } } };
      }
    ).Capacitor.Plugins.PushNotifications.createChannel;
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: 'hydromart_orders' }));
  });

  it('never asks the browser for a VAPID key it cannot use', async () => {
    const push = await load();
    await push.subscribeToPush();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('vapid'))).toBe(false);
  });

  it('reports a denied runtime permission without registering anything', async () => {
    permission = 'denied';
    const push = await load();

    expect(await push.subscribeToPush()).toBe('denied');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports prompt-but-not-granted as unsubscribed, not denied', async () => {
    permission = 'prompt';
    const push = await load();
    expect(await push.subscribeToPush()).toBe('unsubscribed');
  });

  /**
   * A device with no Play Services, or a `google-services.json` that does not match the
   * applicationId, never produces a token. That has to end as a state, not as a promise
   * left hanging on an event that will not arrive.
   */
  it('gives up when registration fails rather than waiting forever', async () => {
    registrationResult = { error: true };
    const push = await load();

    expect(await push.subscribeToPush()).toBe('unsupported');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up when no token arrives at all', async () => {
    registrationResult = {};
    vi.useFakeTimers();
    const push = await load();

    const pending = push.subscribeToPush();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toBe('unsupported');
    vi.useRealTimers();
  });
});

/**
 * `requestPushOnce` spends the one runtime-permission dialog Android will show, so what
 * closes the question matters more than that it is asked. The regression here: the flag
 * used to be written before the attempt, so a granted permission whose token or whose
 * `POST /push/subscribe` failed left a device registered nowhere and nothing left to
 * retry it with.
 */
describe('asking once', () => {
  const asked = () => window.localStorage.getItem('hm.push-asked');

  it('remembers the ask once the device is registered', async () => {
    const push = await load();
    await push.requestPushOnce();

    expect(asked()).toBe('1');
    expect(window.localStorage.getItem('hm.fcm-endpoint')).toBe('fcm:TOKEN-1');
  });

  it('remembers a denial, because Android will not show the dialog again', async () => {
    permission = 'denied';
    const push = await load();
    await push.requestPushOnce();

    expect(asked()).toBe('1');
  });

  it('asks nothing a second time', async () => {
    const push = await load();
    await push.requestPushOnce();
    fetchMock.mockClear();

    await push.requestPushOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the question open when permission was granted but no token arrived', async () => {
    registrationResult = { error: true };
    const push = await load();
    await push.requestPushOnce();

    expect(asked()).toBeNull();
  });

  it('leaves the question open when the endpoint never reached the server', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    const push = await load();
    await push.requestPushOnce();

    expect(asked()).toBeNull();
    // And the next attempt really does try again rather than being a no-op.
    await push.requestPushOnce();
    expect(asked()).toBe('1');
  });
});

describe('reading the state back', () => {
  it('is supported in the WebView even though a service worker would not be', async () => {
    const push = await load();
    expect(push.pushSupported()).toBe(true);
  });

  it('reports subscribed only when a token was actually stored', async () => {
    const push = await load();
    expect(await push.getPushState()).toBe('unsubscribed');

    window.localStorage.setItem('hm.fcm-endpoint', 'fcm:TOKEN-1');
    expect(await push.getPushState()).toBe('subscribed');
  });

  it('reports a denied permission', async () => {
    permission = 'denied';
    const push = await load();
    expect(await push.getPushState()).toBe('denied');
  });
});

describe('unsubscribing', () => {
  it('removes the endpoint server-side and forgets it locally', async () => {
    window.localStorage.setItem('hm.fcm-endpoint', 'fcm:TOKEN-1');
    const push = await load();

    expect(await push.unsubscribeFromPush()).toBe('unsubscribed');
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(init.method).toBe('DELETE');
    expect(url).toContain(encodeURIComponent('fcm:TOKEN-1'));
    expect(window.localStorage.getItem('hm.fcm-endpoint')).toBeNull();
  });

  it('is a no-op when nothing was registered', async () => {
    const push = await load();
    expect(await push.unsubscribeFromPush()).toBe('unsubscribed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
