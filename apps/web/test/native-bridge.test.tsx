/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { render, screen } from '@testing-library/react';
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
  for (const name of ['App', 'Browser', 'Filesystem', 'Share', 'PushNotifications', 'StatusBar']) {
    plugins[name] = {
      setOverlaysWebView: vi.fn(async () => undefined),
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

describe('status bar', () => {
  it('takes the WebView out from under the status bar', () => {
    render(<NativeBridge />);
    // Capacitor draws edge-to-edge by default, which puts every screen's header behind
    // the clock. One call, instead of a safe-area audit of 226 pages.
    expect(plugins.StatusBar!.setOverlaysWebView).toHaveBeenCalledWith({ overlay: false });
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

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<NativeBridge />);
    unmount();
    expect(removed).toContain('backButton');
  });
});

describe('deep links and notification taps', () => {
  it('opens the page an App Link names, rewritten to the route this build has', () => {
    render(<NativeBridge />);
    listeners.appUrlOpen?.({ url: 'https://hydromart.example/orders/o-1' });
    expect(push).toHaveBeenCalledWith('/orders/detail?id=o-1');
  });

  it('opens the destination a tapped notification carries', () => {
    render(<NativeBridge />);
    listeners.pushNotificationActionPerformed?.({
      notification: { data: { url: '/orders/detail?id=o-7' } },
    });
    expect(push).toHaveBeenCalledWith('/orders/detail?id=o-7');
  });

  it('ignores a notification with no destination and a link to another origin', () => {
    render(<NativeBridge />);
    listeners.pushNotificationActionPerformed?.({ notification: {} });
    listeners.appUrlOpen?.({ url: '//evil.example/orders/1' });
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
