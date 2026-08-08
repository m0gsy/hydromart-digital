/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeBridge } from '@/components/native-bridge';
import { openExternal, printDocument, saveFile } from '@/lib/platform';

// F3. The shell's two jobs, plus the three capabilities `platform.ts` reserved a seam
// for in F1. The origin in the docblock is what makes `isNativeShell()` true — the same
// switch the gateway uses, so the two halves cannot disagree.

type Listener = (payload: unknown) => void;

const plugins: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
const listeners: Record<string, Listener> = {};
const removed: string[] = [];

function installBridge() {
  for (const name of ['App', 'Browser', 'Filesystem', 'Share']) {
    plugins[name] = {
      open: vi.fn(async () => undefined),
      share: vi.fn(async () => undefined),
      exitApp: vi.fn(async () => undefined),
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

beforeEach(() => {
  installBridge();
  setUserAgent(MODERN);
});

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
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
