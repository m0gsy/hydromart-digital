/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PushForeground } from '@/components/push-foreground';
import { ToastProvider } from '@/components/toast';

/**
 * E4, second half — a push that arrives while the app is open had no way to be opened.
 *
 * Android draws the tray notification only when the app is backgrounded or dead; in the
 * foreground the plugin emits `pushNotificationReceived` and the app shows a toast. That
 * toast carried the text and nothing else, so the one message the user is guaranteed to be
 * holding the phone for — "your order is on its way" — was the one they could not tap
 * through to. The destination is already in the payload: crm-service puts it in `data.url`,
 * and the same `resolveDeepLink` that handles a tapped tray notification handles it here.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let emit: ((payload: unknown) => void) | null = null;
const schedule = vi.fn(async () => {});

function installBridge() {
  emit = null;
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      PushNotifications: {
        addListener: async (event: string, handler: (p: unknown) => void) => {
          if (event === 'pushNotificationReceived') emit = handler;
          return { remove: () => {} };
        },
      },
      LocalNotifications: { schedule },
    },
  };
}

beforeEach(() => {
  push.mockClear();
  schedule.mockClear();
  installBridge();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

async function mounted() {
  render(
    <ToastProvider>
      <PushForeground />
    </ToastProvider>,
  );
  await vi.waitFor(() => expect(emit).toBeTypeOf('function'));
}

describe('a push that arrives with the app open', () => {
  it('can be tapped through to where it points', async () => {
    await mounted();
    emit?.({
      title: 'Pesanan diterima',
      body: 'Kurir sedang menuju lokasi',
      data: { url: 'https://hydromart.id/orders/detail/?id=ord_9' },
    });
    const item = await screen.findByRole('button', { name: /Kurir sedang menuju lokasi/ });
    await userEvent.click(item);
    // Normalised by `resolveDeepLink`, trailing slash and all — asserting the shape the
    // rewriter actually produces, not the shape the payload happened to carry.
    expect(push).toHaveBeenCalledWith('/orders/detail?id=ord_9');
  });

  it('is plain text, not a dead button, when the payload points nowhere', async () => {
    await mounted();
    emit?.({ title: 'Promo', body: 'Diskon galon hari ini' });
    await screen.findByText(/Diskon galon hari ini/);
    expect(
      screen.queryByRole('button', { name: /Diskon galon hari ini/ }),
      'a button that does nothing on tap is worse than no button',
    ).toBeNull();
  });

  it('never sends the WebView to a foreign origin', async () => {
    await mounted();
    emit?.({ body: 'Klik ini', data: { url: 'https://evil.example.com/steal' } });
    const item = await screen.findByRole('button', { name: /Klik ini/ });
    await userEvent.click(item);
    // The guarantee `pathAndQuery` actually makes, and the only one worth asserting: the
    // ORIGIN is discarded. Honouring it would point our own WebView at somebody else's
    // site; dropping it leaves an in-app route that at worst 404s. The path itself is not
    // filtered here, and does not need to be — this payload comes from crm-service.
    const [target] = push.mock.calls[0] as [string];
    expect(target.startsWith('/'), `navigated to ${target}`).toBe(true);
    expect(target).not.toContain('evil.example.com');
  });
});

/**
 * O4. The toast was the ONLY surface for a push that arrives with the app open, and it is
 * dismissed after 3.2 seconds — the same duration as the "added to cart" pill, for "your
 * order is on its way". The message that would have been in the tray had the app been
 * closed was never in the tray at all.
 */
describe('a push that arrives with the app open, in the tray', () => {
  it('posts the same message as a real notification, on the channel FCM uses', async () => {
    await mounted();
    emit?.({
      title: 'Pesanan diterima',
      body: 'Kurir sedang menuju lokasi',
      data: { url: 'https://hydromart.id/orders/detail/?id=ord_9' },
    });

    await vi.waitFor(() => expect(schedule).toHaveBeenCalled());
    const [{ notifications }] = schedule.mock.calls[0] as unknown as [
      { notifications: Record<string, unknown>[] },
    ];
    expect(notifications[0]).toMatchObject({
      title: 'Pesanan diterima',
      body: 'Kurir sedang menuju lokasi',
      // The channel `ensureChannel()` creates. A second channel would be a mute the user
      // believed they had set and had not.
      channelId: 'hydromart_orders',
    });
    // The destination rides along so the tap has somewhere to go — under `extra`, which is
    // where a LOCAL notification carries it.
    expect(notifications[0]!.extra).toMatchObject({ url: '/orders/detail?id=ord_9' });
    // An int32, and different per message: Android REPLACES a notification posted with an
    // id it already has, so a courier with three tasks would see one.
    expect(Number.isInteger(notifications[0]!.id)).toBe(true);
    expect(notifications[0]!.id as number).toBeLessThan(2_147_483_647);
  });

  // A build without the plugin (an older APK, the web) must keep the old behaviour rather
  // than throw on a bridge that is not there.
  it('still shows the toast when there is no local-notification plugin', async () => {
    delete (window as unknown as { Capacitor: { Plugins: Record<string, unknown> } }).Capacitor
      .Plugins.LocalNotifications;
    await mounted();
    emit?.({ title: 'Pesanan diterima', body: 'Kurir sedang menuju lokasi' });

    expect(await screen.findByText(/Pesanan diterima/)).toBeInTheDocument();
    expect(schedule).not.toHaveBeenCalled();
  });
});
