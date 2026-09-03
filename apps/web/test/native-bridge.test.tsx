/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeBridge } from '@/components/native-bridge';
import { openExternal, printDocument, saveFile } from '@/lib/platform';

// The bridge navigates, and outside a Next app there is no router to navigate with.
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// F3. The shell's two jobs, plus the three capabilities `platform.ts` reserved a seam
// for in F1. The origin in the docblock is what makes `isNativeShell()` true — the same
// switch the gateway uses, so the two halves cannot disagree.

type Listener = (payload: unknown) => void;

const plugins: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
const listeners: Record<string, Listener> = {};
const removed: string[] = [];

/** What `App.getInfo()` reports — the installed binary's own versionCode. */
let appInfo: { id?: string; build?: string } | null = { id: 'id.hydromart.app', build: '12' };

/** What `App.getLaunchUrl()` reports — the URL this process was started with, if any. */
let launchUrl: { url?: string } | null = null;

function installBridge() {
  for (const name of [
    'App',
    'Browser',
    'Filesystem',
    'Share',
    'PushNotifications',
    'StatusBar',
    'SplashScreen',
  ]) {
    plugins[name] = {
      hide: vi.fn(async () => undefined),
      setStyle: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
      share: vi.fn(async () => undefined),
      exitApp: vi.fn(async () => undefined),
      getInfo: vi.fn(async () => appInfo),
      getLaunchUrl: vi.fn(async () => launchUrl),
      writeFile: vi.fn(async () => ({ uri: 'file:///cache/x' })),
      addListener: vi.fn(async (event: string, handler: Listener) => {
        listeners[event] = handler;
        return { remove: () => removed.push(event) };
      }),
    };
  }
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: plugins };
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

const MODERN = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile';

/** What `GET /mobile-config` answers. 0 = the gate is off, the normal state. */
let mobileConfig: unknown = { minVersionCode: 0, updateMessage: '' };
let mobileConfigStatus = 200;

beforeEach(() => {
  push.mockClear();
  launchUrl = null;
  installBridge();
  setUserAgent(MODERN);
  appInfo = { id: 'id.hydromart.app', build: '12' };
  mobileConfig = { minVersionCode: 0, updateMessage: '' };
  mobileConfigStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(mobileConfig), {
          status: mobileConfigStatus,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
});

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('WebView version gate', () => {
  it('renders nothing on a WebView new enough for Tailwind v4', () => {
    const { container } = render(<NativeBridge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('blocks a WebView older than Chrome 111 with a way out', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/98.0.0.0 Mobile');
    render(<NativeBridge />);

    expect(screen.getByRole('heading', { name: /WebView/i })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Play Store/i });
    expect(button).toBeInTheDocument();
    // The link is `market://`, which must NOT go through the browser plugin — a Custom
    // Tab renders in the very WebView this screen exists because of. Asserted through
    // the plugin rather than through `location`, which jsdom will not let a test watch.
    button.click();
    expect(plugins.Browser!.open).not.toHaveBeenCalled();
  });

  /**
   * A user locked out by a bad guess has no way to reach support inside an app they
   * cannot open, so an unrecognised WebView is let through.
   */
  it('lets an unrecognisable user agent through rather than guessing', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 13) SomeOtherEngine/1.0');
    const { container } = render(<NativeBridge />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('minimum version gate', () => {
  it('lets a current build through', async () => {
    mobileConfig = { minVersionCode: 12 };
    const { container } = render(<NativeBridge />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('blocks a build below the minimum and points at THIS app, not the WebView', async () => {
    mobileConfig = { minVersionCode: 20, updateMessage: 'Ada perbaikan penting.' };
    render(<NativeBridge />);

    await screen.findByRole('heading', { name: /usang/i });
    expect(screen.getByText('Ada perbaikan penting.')).toBeInTheDocument();
  });

  it('falls back to its own copy when the server sends no message', async () => {
    mobileConfig = { minVersionCode: 20, updateMessage: '' };
    render(<NativeBridge />);
    expect(
      await screen.findByText(/Perbarui lewat Play Store untuk melanjutkan/i),
    ).toBeInTheDocument();
  });

  /*
   * N5. The floor is per package now, because both binaries are built from the same run
   * and share a versionCode series — one global integer could only stop both at once.
   */
  it('asks about THIS package, not about mobile in general', async () => {
    render(<NativeBridge />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]);
    expect(url).toContain('/mobile-config?id=id.hydromart.app');
  });

  /*
   * N6. This screen was a dead end: one `market://` button, and back exits the app. The
   * reasons a device actually lands here — staged rollout, regional propagation, a stale
   * Play cache — are all cases where the update exists and this phone cannot see it yet.
   */
  it('offers a web Play link as well as the Play app', async () => {
    mobileConfig = { minVersionCode: 20, updateMessage: '' };
    render(<NativeBridge />);
    await screen.findByRole('heading', { name: /usang/i });
    expect(screen.getByText(/Buka lewat browser/i)).toBeInTheDocument();
  });

  it('lets the screen release itself once the floor no longer blocks this build', async () => {
    mobileConfig = { minVersionCode: 20, updateMessage: '' };
    const { container } = render(<NativeBridge />);
    await screen.findByRole('heading', { name: /usang/i });

    // The floor was lowered (or this device finally sees the current answer).
    mobileConfig = { minVersionCode: 0, updateMessage: '' };
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/i }));
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  /**
   * Every failure below fails OPEN. The gate is a kill switch for us; it must never be
   * the reason a working app refuses to start.
   */
  it.each([
    ['the gateway is unreachable', () => (mobileConfigStatus = 503)],
    ['the answer is malformed', () => (mobileConfig = { minVersionCode: 'soon' })],
    ['the gate is off', () => (mobileConfig = { minVersionCode: 0 })],
    ['the plugin cannot say what version this is', () => (appInfo = null)],
    ['the build number is not a number', () => (appInfo = { id: 'id.hydromart.app', build: 'x' })],
  ])('does not block when %s', async (_label, arrange) => {
    arrange();
    const { container } = render(<NativeBridge />);
    // Give the whole async check a chance to have blocked, then assert it did not.
    await vi.waitFor(() => expect(plugins.App!.getInfo).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('does not even ask when the WebView is already too old to render the answer', async () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/98.0.0.0 Mobile');
    mobileConfig = { minVersionCode: 20 };
    render(<NativeBridge />);

    expect(screen.getByRole('heading', { name: /WebView/i })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('splash screen', () => {
  // `launchAutoHide` is off in capacitor.config.ts, so nothing else dismisses it.
  it('hides the splash once the shell has mounted', () => {
    render(<NativeBridge />);
    expect(plugins.SplashScreen!.hide).toHaveBeenCalled();
  });

  // The branch that blocks an ancient WebView returns before everything else in the
  // effect. Hiding after it would leave that screen behind a splash forever.
  it('hides it even when the WebView is too old to run the app', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/98.0.0.0 Mobile');
    render(<NativeBridge />);
    expect(screen.getByRole('heading', { name: /WebView/i })).toBeInTheDocument();
    expect(plugins.SplashScreen!.hide).toHaveBeenCalled();
  });
});

describe('hardware back button', () => {
  it('closes the top overlay instead of navigating', () => {
    const closed = vi.fn();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closed();
    });
    document.body.insertAdjacentHTML('beforeend', '<div aria-modal="true">sheet</div>');
    render(<NativeBridge />);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    listeners.backButton?.({ canGoBack: true });

    expect(closed).toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(plugins.App!.exitApp).not.toHaveBeenCalled();
    document.querySelector('[aria-modal="true"]')?.remove();
  });

  it('goes back through history when there is history', () => {
    render(<NativeBridge />);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    // jsdom starts with one entry; push one so the app has somewhere to go back to.
    window.history.pushState({}, '', '/cart');

    listeners.backButton?.({ canGoBack: true });

    expect(back).toHaveBeenCalled();
    expect(plugins.App!.exitApp).not.toHaveBeenCalled();
  });

  // The regression this pair exists for: `history.length` counts entries and never counts
  // down, so on the first entry it still reads 2 and `history.back()` is a silent no-op.
  // Only the event knows where in the stack the WebView actually is.
  it('leaves the app when the WebView is on its first history entry', () => {
    render(<NativeBridge />);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    window.history.pushState({}, '', '/cart');

    listeners.backButton?.({ canGoBack: false });

    expect(back).not.toHaveBeenCalled();
    expect(plugins.App!.exitApp).toHaveBeenCalled();
  });

  it('falls back to the history length when the event carries no answer', () => {
    render(<NativeBridge />);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    window.history.pushState({}, '', '/cart');

    listeners.backButton?.({});

    expect(back).toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<NativeBridge />);
    unmount();
    expect(removed).toContain('backButton');
  });
});

describe('deep links and notification taps', () => {
  /*
   * J4. Every listener below is wired while `GET /mobile-config` is still in flight, so a
   * link that arrives in that window is HELD until the verdict says this build may serve
   * it. These assertions are therefore `waitFor` rather than synchronous: the push happens
   * when the answer lands, not when the listener fires.
   */
  it('opens the page an App Link names, rewritten to the route this build has', async () => {
    render(<NativeBridge />);
    listeners.appUrlOpen?.({ url: 'https://hydromart.example/orders/o-1' });
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/orders/detail?id=o-1'));
  });

  it('opens the destination a tapped notification carries', async () => {
    render(<NativeBridge />);
    listeners.pushNotificationActionPerformed?.({
      notification: { data: { url: '/orders/detail?id=o-7' } },
    });
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/orders/detail?id=o-7'));
  });

  it('ignores a notification with no destination and a link to another origin', async () => {
    render(<NativeBridge />);
    listeners.pushNotificationActionPerformed?.({ notification: {} });
    listeners.appUrlOpen?.({ url: '//evil.example/orders/1' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it('follows the URL the app was launched with from cold', async () => {
    // A fresh module graph: the launch URL is answered once per process, and the module
    // remembers having done it.
    vi.resetModules();
    const { NativeBridge: Fresh } = await import('@/components/native-bridge');
    launchUrl = { url: 'https://hydromart.example/products/p-3' };

    render(<Fresh />);

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/products/detail?id=p-3'));
  });

  it('unsubscribes from both on unmount', () => {
    const { unmount } = render(<NativeBridge />);
    unmount();
    expect(removed).toContain('appUrlOpen');
    expect(removed).toContain('pushNotificationActionPerformed');
  });
});

/**
 * J4 — a blocked app used to burn the link that opened it.
 *
 * `minimumVersionBlock()` is a network round trip, and every listener is wired while it is
 * in flight. So a build below the minimum did all of this anyway: pushed at the deep link,
 * landed on it UNDERNEATH the blocking overlay, and set the module-level `launchHandled`,
 * which spends the launch URL for the whole process. The person updates, comes back, and
 * the link that started the whole thing is simply gone.
 */
describe('a link that arrives before the version verdict (J4)', () => {
  it('does not navigate under the blocking screen', async () => {
    mobileConfig = { minVersionCode: 20, updateMessage: 'Perbarui dulu.' };
    render(<NativeBridge />);

    listeners.appUrlOpen?.({ url: 'https://hydromart.example/orders/o-1' });
    await screen.findByRole('heading', { name: /usang/i });

    expect(push).not.toHaveBeenCalled();
  });

  it('does not spend the launch URL, so the next mount can still act on it', async () => {
    vi.resetModules();
    const { NativeBridge: Fresh } = await import('@/components/native-bridge');
    launchUrl = { url: 'https://hydromart.example/products/p-3' };
    mobileConfig = { minVersionCode: 20, updateMessage: 'Perbarui dulu.' };

    const blocked = render(<Fresh />);
    await screen.findByRole('heading', { name: /usang/i });
    expect(push).not.toHaveBeenCalled();
    blocked.unmount();

    // The update landed; the same process mounts again and the link is still there.
    mobileConfig = { minVersionCode: 0, updateMessage: '' };
    render(<Fresh />);

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/products/detail?id=p-3'));
  });

  it('follows a link held during the check once the verdict clears it', async () => {
    render(<NativeBridge />);

    // Fired synchronously, i.e. before `GET /mobile-config` can possibly have answered.
    listeners.appUrlOpen?.({ url: 'https://hydromart.example/orders/o-9' });

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/orders/detail?id=o-9'));
  });
});

describe('platform capabilities on native', () => {
  it('opens a web link in a Custom Tab and a scheme link as an Intent', () => {
    expect(openExternal('https://wa.me/62811')).toBe(true);
    expect(plugins.Browser!.open).toHaveBeenCalledWith({ url: 'https://wa.me/62811' });

    // A scheme link is claimed (true) but never handed to the browser plugin — it goes
    // to the WebView, which turns it into an Android Intent.
    plugins.Browser!.open!.mockClear();
    expect(openExternal('tel:+62811')).toBe(true);
    expect(plugins.Browser!.open).not.toHaveBeenCalled();
  });

  it('writes a download to the cache and offers the share sheet', async () => {
    expect(saveFile('laporan.csv', new Blob(['a,b'], { type: 'text/csv' }))).toBe(true);

    // The write is asynchronous behind a synchronous caller (`downloadBlob`), so let the
    // FileReader and both plugin calls settle.
    await vi.waitFor(() => expect(plugins.Share!.share).toHaveBeenCalled());
    expect(plugins.Filesystem!.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'laporan.csv', directory: 'CACHE' }),
    );
    expect(plugins.Share!.share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['file:///cache/x'] }),
    );
  });

  it('shares a receipt rather than calling window.print', async () => {
    expect(printDocument('<html>struk</html>')).toBe(true);
    await vi.waitFor(() => expect(plugins.Share!.share).toHaveBeenCalled());
    expect(plugins.Filesystem!.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'struk.html' }),
    );
  });

  it('reports failure instead of throwing when a plugin is missing', () => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    expect(openExternal('https://hydromart.id')).toBe(false);
    expect(saveFile('x.csv', new Blob(['x']))).toBe(true); // native path taken, write no-ops
  });
});
