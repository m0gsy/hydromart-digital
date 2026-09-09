// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The browser half of Web Push.
 *
 * Every failure mode here is silent by nature: a denied permission, a server with no VAPID
 * key configured, a browser with no PushManager. Nothing throws, nothing appears on screen,
 * and the customer simply never receives a notification — so the only thing standing
 * between "push works" and "push has been off for a month" is that these four states stay
 * distinguishable to the caller.
 */

const { get, post, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
const { isNativeShell } = vi.hoisted(() => ({ isNativeShell: vi.fn(() => false) }));

vi.mock('@/lib/api', () => ({ api: { get, post, del }, ApiError: class extends Error {} }));
vi.mock('@/lib/platform', () => ({ isNativeShell, isAndroidShell: () => false }));
vi.mock('@/lib/capacitor', () => ({
  askPlugin: vi.fn(async () => ({})),
  onPluginEvent: vi.fn(() => () => {}),
}));
vi.mock('@/lib/secure-vault', () => ({
  vaultRead: vi.fn(async () => null),
  vaultWrite: vi.fn(async () => {}),
  vaultClear: vi.fn(async () => {}),
}));

import { getPushState, pushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/push';

const SUB = {
  endpoint: 'https://push.example/abc',
  toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
};

function browserWithPush(sub: unknown = null) {
  const pushManager = {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async () => SUB),
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => registration),
      register: vi.fn(async () => registration),
    },
  });
  (window as unknown as { PushManager: unknown }).PushManager = function () {};
  return { registration, pushManager };
}

function permission(value: NotificationPermission, requested = value) {
  (window as unknown as { Notification: unknown }).Notification = {
    permission: value,
    requestPermission: vi.fn(async () => requested),
  };
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ key: 'BExampleVapidKey' });
  post.mockReset().mockResolvedValue({});
  del.mockReset().mockResolvedValue({});
  isNativeShell.mockReturnValue(false);
  browserWithPush();
  permission('granted');
});

afterEach(() => {
  delete (window as unknown as { PushManager?: unknown }).PushManager;
  delete (window as unknown as { Notification?: unknown }).Notification;
});

describe('push support detection', () => {
  it('is unsupported when the browser has no PushManager', () => {
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    expect(pushSupported()).toBe(false);
  });

  it('is supported once the three browser pieces are present', () => {
    expect(pushSupported()).toBe(true);
  });
});

describe('subscribing', () => {
  it('registers the endpoint with the server and reports subscribed', async () => {
    await expect(subscribeToPush()).resolves.toBe('subscribed');

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/push/subscriptions'),
      { endpoint: SUB.endpoint, keys: { p256dh: 'p', auth: 'a' } },
      true,
    );
  });

  it('reports a denied permission as denied, and asks the server for nothing', async () => {
    permission('default', 'denied');
    await expect(subscribeToPush()).resolves.toBe('denied');
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('reports a dismissed prompt as unsubscribed, not as denied', async () => {
    // Dismissing is not refusing: the browser will ask again, so the two must not collapse.
    permission('default', 'default');
    await expect(subscribeToPush()).resolves.toBe('unsubscribed');
  });

  /*
   * A server with no VAPID key cannot send anything. Reporting 'unsupported' rather than
   * subscribing keeps the app from recording an endpoint nothing will ever push to.
   */
  it('stops when the server has no VAPID key configured', async () => {
    get.mockResolvedValue({ key: '' });
    await expect(subscribeToPush()).resolves.toBe('unsupported');
    expect(post).not.toHaveBeenCalled();
  });

  it('reuses an existing subscription instead of minting a second one', async () => {
    const { pushManager } = browserWithPush(SUB);
    await expect(subscribeToPush()).resolves.toBe('subscribed');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('is unsupported outright when the browser cannot do push', async () => {
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    await expect(subscribeToPush()).resolves.toBe('unsupported');
  });
});

describe('reading the state without prompting', () => {
  it('says subscribed when a subscription is already on the registration', async () => {
    browserWithPush(SUB);
    await expect(getPushState()).resolves.toBe('subscribed');
    // Reading state must never ask for permission — that is what the button is for.
    expect(
      (window as unknown as { Notification: { requestPermission: unknown } }).Notification
        .requestPermission,
    ).not.toHaveBeenCalled();
  });

  it('says unsubscribed when there is none', async () => {
    await expect(getPushState()).resolves.toBe('unsubscribed');
  });

  it('says denied without touching the service worker', async () => {
    permission('denied');
    await expect(getPushState()).resolves.toBe('denied');
  });

  it('says unsupported when the browser cannot do push at all', async () => {
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    await expect(getPushState()).resolves.toBe('unsupported');
  });
});

describe('unsubscribing', () => {
  it('removes the endpoint from the server and locally', async () => {
    browserWithPush(SUB);
    await expect(unsubscribeFromPush()).resolves.toBe('unsubscribed');

    expect(del).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(SUB.endpoint)),
      true,
    );
    expect(SUB.unsubscribe).toHaveBeenCalled();
  });

  it('is a no-op when there was nothing subscribed', async () => {
    await expect(unsubscribeFromPush()).resolves.toBe('unsubscribed');
    expect(del).not.toHaveBeenCalled();
  });

  it('is unsupported when the browser cannot do push', async () => {
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    await expect(unsubscribeFromPush()).resolves.toBe('unsupported');
  });
});
