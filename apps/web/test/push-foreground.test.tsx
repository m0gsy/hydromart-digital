/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PushForeground } from '@/components/push-foreground';
import { ToastProvider } from '@/components/toast';

// A push arriving while the app is open reaches the plugin and, before this component,
// reached nothing else: Android draws the tray notification only for a backgrounded app.
// The origin in the docblock is what makes `isNativeShell()` true.

type Listener = (payload: unknown) => void;

const listeners: Record<string, Listener> = {};
const removed: string[] = [];

function installBridge() {
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    Plugins: {
      PushNotifications: {
        addListener: vi.fn(async (event: string, handler: Listener) => {
          listeners[event] = handler;
          return { remove: () => removed.push(event) };
        }),
      },
    },
  };
}

function mount() {
  return render(
    <ToastProvider>
      <PushForeground />
    </ToastProvider>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(listeners)) delete listeners[key];
  removed.length = 0;
  installBridge();
});

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('foreground push', () => {
  it('shows the notification the tray would not have drawn', async () => {
    mount();

    listeners.pushNotificationReceived?.({
      title: 'Pesanan dikirim',
      body: 'Kurir sedang menuju alamatmu.',
    });

    expect(await screen.findByText('Pesanan dikirim — Kurir sedang menuju alamatmu.')).toBeTruthy();
  });

  it('shows whichever half arrived', async () => {
    mount();

    listeners.pushNotificationReceived?.({ body: 'Kurir sedang menuju alamatmu.' });

    expect(await screen.findByText('Kurir sedang menuju alamatmu.')).toBeTruthy();
  });

  // A data-only message has no title and no body. There is nothing to show, and an empty
  // pill on the screen is worse than silence.
  it('stays quiet when there is nothing to say', () => {
    const { container } = mount();

    listeners.pushNotificationReceived?.({ data: { url: '/orders' } });

    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('unsubscribes on unmount', async () => {
    mount().unmount();
    // `onPluginEvent` hands back a cleanup that awaits the addListener promise before it
    // can call `remove()`, so the removal lands a microtask after unmount, not during it.
    await vi.waitFor(() => expect(removed).toContain('pushNotificationReceived'));
  });
});
