/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import GlobalError from '@/app/global-error';
import { SPLASH_NET_MS, SPLASH_NET_SCRIPT } from '@/lib/splash-net';

/**
 * E1 — the splash is dismissed by JS and by nothing else (`launchAutoHide: false` in
 * `mobile/capacitor.config.ts`). Its only caller was `NativeBridge`, which lives inside the
 * root layout. So a root layout that throws takes the one thing that hides the splash down
 * with it: `global-error.tsx` renders its OWN <html>/<body>, replacing the layout entirely,
 * and the user is left staring at a splash screen with no way out and nothing to read.
 *
 * Two nets, because they cover different failures and neither covers both:
 *
 *   1. this one — React IS running, it just could not render the layout. `global-error`
 *      hides the splash itself, immediately.
 *   2. the inline <script> in `layout.tsx` — React is NOT running at all (a chunk 404s, or
 *      the WebView rejects the syntax before hydration). No component mounts, so no
 *      component can help; only markup already in the document can. That one is verified
 *      by `layout-splash-net.test.ts` beside this file.
 */

function installSplashPlugin() {
  const hide = vi.fn(async () => {});
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    Plugins: { SplashScreen: { hide } },
  };
  return hide;
}

beforeEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('global-error hides the splash', () => {
  it('calls SplashScreen.hide when the root layout has failed', () => {
    const hide = installSplashPlugin();
    render(<GlobalError error={new Error('root layout exploded')} reset={() => {}} />);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('the inline net actually hides the splash when no component ever mounts', () => {
    const hide = installSplashPlugin();
    vi.useFakeTimers();
    // Executed the way the browser will execute it: as source, with no bundle, no React
    // and no module system — the situation it exists for.
    new Function(SPLASH_NET_SCRIPT)();
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SPLASH_NET_MS - 1);
    expect(hide, 'must not fire early and cut a slow cold start short').not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('the inline net is a no-op, not a throw, when the bridge is absent', () => {
    vi.useFakeTimers();
    new Function(SPLASH_NET_SCRIPT)();
    expect(() => vi.advanceTimersByTime(SPLASH_NET_MS)).not.toThrow();
    vi.useRealTimers();
  });

  it('does not throw with no Capacitor at all', () => {
    // The web build renders this file too, and so does an old WebView with no bridge
    // injected yet. A missing plugin must be a no-op — a second error thrown from inside
    // the error screen has nowhere left to be caught.
    expect(() => render(<GlobalError error={new Error('boom')} reset={() => {}} />)).not.toThrow();
  });
});

/**
 * N3. Play Vitals reports native process crashes and ANRs. A TypeError in a React tree is
 * neither: it renders THIS screen, on a build with no WebView debugging and no console in
 * logcat — so the whole class of failure a user actually meets was invisible in production.
 * The boundary that holds the error is the only thing that can report it, and it cannot
 * lean on `SentryInit`: that component lives in the root layout, which is what just failed.
 */
describe('global-error reports the crash nothing else can see', () => {
  const captureException = vi.fn();
  const init = vi.fn();
  let client: unknown = null;

  beforeEach(() => {
    captureException.mockClear();
    init.mockClear();
    client = null;
    vi.doMock('@sentry/nextjs', () => ({
      captureException,
      init,
      getClient: () => client,
    }));
  });

  afterEach(() => {
    vi.doUnmock('@sentry/nextjs');
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it('sends nothing at all when no DSN was built in', async () => {
    render(<GlobalError error={new Error('boom')} reset={() => {}} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('initialises on the spot and reports, because the layout never ran', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://k@example.ingest.sentry.io/1';
    render(<GlobalError error={new Error('boom')} reset={() => {}} />);
    await vi.waitFor(() => expect(captureException).toHaveBeenCalled());
    expect(init).toHaveBeenCalled();
    expect(captureException.mock.calls[0]![1]).toMatchObject({ tags: { boundary: 'global-error' } });
  });
});
