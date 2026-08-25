// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { persistSafeAreaInsets } from '@/lib/safe-area-persist';

const KEY = 'hydromart.safeAreaInsets';

/**
 * This module exists for one device: a notched phone on a WebView below 140, where `env()`
 * is 0 and the Capacitor plugin's value is the only real number there is. In an exported
 * build every route is its own document, so that value is lost on the first navigation and
 * nothing puts it back — the inset applies until the customer taps once, then vanishes.
 *
 * None of that is reachable from a desktop browser, and none of it was covered. What was
 * covered was the one path where the plugin has already written the values, which is the
 * path that never had the bug.
 */
describe('persistSafeAreaInsets', () => {
  const setInset = (side: string, value: string) =>
    document.documentElement.style.setProperty(`--safe-area-inset-${side}`, value);

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records the values a document already has — that document is the source of truth', () => {
    setInset('top', '44px');
    setInset('bottom', '34px');
    persistSafeAreaInsets();
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? '{}')).toMatchObject({
      top: '44px',
      bottom: '34px',
    });
  });

  it('puts them back on a document that has none — the navigation case it exists for', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ top: '44px', bottom: '34px' }));
    persistSafeAreaInsets();
    expect(document.documentElement.style.getPropertyValue('--safe-area-inset-top')).toBe('44px');
    expect(document.documentElement.style.getPropertyValue('--safe-area-inset-bottom')).toBe('34px');
  });

  it('never overwrites a side the device IS reporting, even when it reports zero', () => {
    setInset('top', '0px');
    sessionStorage.setItem(KEY, JSON.stringify({ top: '44px' }));
    persistSafeAreaInsets();
    // A remembered 44px over a live 0px would be inventing an inset the phone denies.
    expect(document.documentElement.style.getPropertyValue('--safe-area-inset-top')).toBe('0px');
  });

  it('does nothing at all when there is nothing remembered', () => {
    persistSafeAreaInsets();
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('drops a corrupt entry rather than carrying it into every future document', () => {
    sessionStorage.setItem(KEY, '{not json');
    persistSafeAreaInsets();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  /*
   * J5. This used to be two shots inside a 400 ms window, which is a guess about the
   * ordering — and the wrong kind. A cold start, a slow device or a WebView still warming
   * up writes its insets later than that, nothing looks again, and the app bar sits under
   * the status bar for the whole session. `style.setProperty` on `documentElement` is
   * exactly what the plugin does, so that is what is watched.
   */
  it('records insets the plugin writes LONG after the 400ms window', async () => {
    persistSafeAreaInsets();

    // Two seconds later — five times the old window.
    setInset('top', '44px');
    await Promise.resolve();

    expect(JSON.parse(sessionStorage.getItem(KEY) ?? '{}')).toMatchObject({ top: '44px' });
  });

  it('stops watching once there is an answer', async () => {
    setInset('top', '44px');
    persistSafeAreaInsets();

    // A later write is somebody else's business; this module has what it came for.
    sessionStorage.setItem(KEY, JSON.stringify({ marker: 'untouched' }));
    setInset('top', '48px');
    await Promise.resolve();

    expect(JSON.parse(sessionStorage.getItem(KEY) ?? '{}')).toMatchObject({ marker: 'untouched' });
  });

  it('the disposer stops it — an uncancellable timer crashed the whole suite', async () => {
    const dispose = persistSafeAreaInsets();
    dispose();

    setInset('top', '44px');
    await Promise.resolve();

    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('gives up after its deadline rather than watching a document forever', () => {
    persistSafeAreaInsets();
    vi.advanceTimersByTime(10_000);

    // Nothing is asserted about the DOM here; what matters is that the watcher is gone,
    // which the next write proves by not being recorded.
    setInset('top', '44px');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
