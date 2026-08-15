/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { onPluginEvent } from '@/lib/capacitor';

/**
 * The unsubscribe returned by `onPluginEvent` must survive an `addListener` that answers
 * with a PLAIN handle rather than a promise for one — which is what the native bridge
 * actually does for `@capacitor/app`.
 *
 * It did not. `handle.then(...)` on a plain object throws `TypeError: u.then is not a
 * function`, and the one caller that matters registers its listener in the ROOT layout
 * (`native-bridge.tsx`, the hardware back button). A throw in that effect's teardown has no
 * error boundary beneath it, so React unwinds to `global-error` and the user gets
 * "Ada yang tidak beres" — on whatever route they happened to be navigating to. That is the
 * bug this file exists to keep fixed; it was found on a real device, not in a test.
 */
declare global {
  // eslint-disable-next-line no-var
  var Capacitor: unknown;
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

function withAddListener(addListener: (e: string, h: () => void) => unknown) {
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: { App: { addListener } },
  };
}

describe('onPluginEvent cleanup', () => {
  it('does not throw when addListener returns a plain handle', async () => {
    const remove = vi.fn();
    withAddListener(() => ({ remove }));

    const off = onPluginEvent('App', 'backButton', () => {});
    expect(() => off()).not.toThrow();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('still works when addListener returns a promise for a handle', async () => {
    const remove = vi.fn();
    withAddListener(() => Promise.resolve({ remove }));

    const off = onPluginEvent('App', 'backButton', () => {});
    expect(() => off()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('is a no-op when the plugin is absent', () => {
    expect(() => onPluginEvent('App', 'backButton', () => {})()).not.toThrow();
  });
});
