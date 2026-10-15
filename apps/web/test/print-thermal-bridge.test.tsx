/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printDocument } from '@/lib/platform';

// `https://localhost` is what makes `isNativeShell()` true — the Capacitor WebView origin.
const plugins: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};

function install(thermal: Record<string, () => unknown>) {
  plugins.Filesystem = { writeFile: vi.fn(async () => ({ uri: 'file:///cache/x' })) };
  plugins.Share = { share: vi.fn(async () => undefined) };
  plugins.ThermalPrinter = Object.fromEntries(
    Object.entries(thermal).map(([k, v]) => [k, vi.fn(async () => v())]),
  );
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: plugins };
}

const thermal = { items: [{ type: 'text' as const, value: 'x' }], paperWidthMm: 58 };

beforeEach(() => {
  for (const k of Object.keys(plugins)) delete plugins[k];
});
afterEach(() => vi.clearAllMocks());

describe('printDocument with a thermal printer', () => {
  it('prints and does NOT share when the printer takes it', async () => {
    install({ getDefaultPrinter: () => ({ profile: { id: 'bt:1' } }), printText: () => ({}) });
    expect(printDocument('<html>struk</html>', thermal)).toBe(true);
    await vi.waitFor(() => expect(plugins.ThermalPrinter!.printText).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(plugins.Share!.share).not.toHaveBeenCalled();
  });

  it('shares the file, silently, when no printer was ever saved', async () => {
    install({ getDefaultPrinter: () => ({ profile: null }) });
    const onFailed = vi.fn();
    expect(printDocument('<html>struk</html>', { ...thermal, onFailed })).toBe(true);
    await vi.waitFor(() => expect(plugins.Share!.share).toHaveBeenCalled());
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('shares the file AND says why when a saved printer fails', async () => {
    install({
      getDefaultPrinter: () => ({ profile: { id: 'bt:1' } }),
      printText: () => {
        throw Object.assign(new Error('x'), { code: 'PRINTER_OFFLINE' });
      },
    });
    const onFailed = vi.fn();
    expect(printDocument('<html>struk</html>', { ...thermal, onFailed })).toBe(true);
    await vi.waitFor(() => expect(plugins.Share!.share).toHaveBeenCalled());
    expect(onFailed).toHaveBeenCalledWith({ kind: 'failed', code: 'PRINTER_OFFLINE' });
  });

  it('copes with a failure and no callback', async () => {
    install({
      getDefaultPrinter: () => ({ profile: { id: 'bt:1' } }),
      printText: () => {
        throw Object.assign(new Error('x'), { code: 'TIMEOUT' });
      },
    });
    expect(printDocument('<html>struk</html>', thermal)).toBe(true);
    await vi.waitFor(() => expect(plugins.Share!.share).toHaveBeenCalled());
  });

  it('shares as before when the caller passes no thermal job', async () => {
    install({});
    expect(printDocument('<html>struk</html>')).toBe(true);
    await vi.waitFor(() => expect(plugins.Share!.share).toHaveBeenCalled());
  });
});
