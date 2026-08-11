/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeBridge } from '@/components/native-bridge';

/**
 * E2 — the hardware back button on the "WebView too old" blocking screen.
 *
 * `NativeBridge` used to `return` out of its effect the moment it decided to block, and
 * the `backButton` listener was registered several lines BELOW that return. With no JS
 * listener the App plugin falls back to its own handling, which navigates history if it
 * can and otherwise does nothing at all — it never finishes the activity. On the blocking
 * screen there is no history, so the button is inert: the app cannot be closed with it.
 * The only ways out are the task switcher and the Play Store button.
 *
 * The listener is now registered before any early return, and answers "leave the app"
 * while the blocker is up.
 */

const OLD_WEBVIEW = 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/98.0.0.0 Mobile';
const NEW_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile';

// One stable object, the way the real `useRouter` behaves. A fresh object per render would
// re-run the effect on every `setBlock`, and `onPluginEvent`'s cleanup removes its listener
// asynchronously — so the previous run's removal lands AFTER the next run's registration
// and deletes it. That is a bug in the mock, not in the component, and it cost a red run.
const router = { push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

/** Captures the handler each listener registers, so the test can fire the event itself. */
function installBridge() {
  const listeners: Record<string, (payload: unknown) => void> = {};
  const exitApp = vi.fn();
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      SplashScreen: { hide: vi.fn(async () => {}) },
      App: {
        addListener: async (event: string, handler: (payload: unknown) => void) => {
          listeners[event] = handler;
          return { remove: () => delete listeners[event] };
        },
        exitApp,
        getLaunchUrl: async () => ({}),
        getInfo: async () => ({ id: 'id.hydromart.app', build: '999' }),
      },
      PushNotifications: {
        addListener: async (event: string, handler: (payload: unknown) => void) => {
          listeners[event] = handler;
          return { remove: () => delete listeners[event] };
        },
      },
    },
  };
  return { listeners, exitApp };
}

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  setUserAgent(NEW_WEBVIEW);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('back button on the blocking screen', () => {
  it('registers a backButton listener even when the WebView is refused', async () => {
    setUserAgent(OLD_WEBVIEW);
    const { listeners } = installBridge();
    render(<NativeBridge />);
    await screen.findByText('Perbarui Android System WebView');
    expect(
      listeners.backButton,
      'the blocking screen is exactly where a dead back button traps the user',
    ).toBeTypeOf('function');
  });

  it('leaves the app when back is pressed on the blocking screen', async () => {
    setUserAgent(OLD_WEBVIEW);
    const { listeners, exitApp } = installBridge();
    render(<NativeBridge />);
    await screen.findByText('Perbarui Android System WebView');
    // `canGoBack: true` on purpose: the WebView may well have entries, and going back to
    // a page rendered by a WebView this build refuses to run is not an exit.
    listeners.backButton?.({ canGoBack: true });
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('still navigates history normally when nothing is blocking', async () => {
    const { listeners, exitApp } = installBridge();
    render(<NativeBridge />);
    await vi.waitFor(() => expect(listeners.backButton).toBeTypeOf('function'));
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    listeners.backButton?.({ canGoBack: true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
  });
});
