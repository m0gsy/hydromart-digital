// @vitest-environment jsdom
/**
 * 2026-11-25: 44 of the 56 staff who punched that week held only "Perkiraan" (Android's
 * approximate location), and with the HR fence off nothing told them so. The notice says it on
 * the two check-in screens, never blocks, never asks for a permission itself, and goes away once
 * the phone comes back from Settings switched to "Tepat".
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreciseLocationNotice } from '@/components/hr/precise-location-notice';
import { id as idDict } from '@/lib/dictionaries/id';
import { LocaleProvider } from '@/lib/locale-context';

const N = idDict.hrFix.preciseLocation;

type Perms = { location?: string; coarseLocation?: string };

/** A native shell whose location permission reads as `perms`; records reads and requests. */
function shell(initial: Perms) {
  let perms = initial;
  const checkPermissions = vi.fn(() => Promise.resolve(perms));
  const requestPermissions = vi.fn(() => Promise.resolve(perms));
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    Plugins: { Geolocation: { checkPermissions, requestPermissions } },
  };
  return {
    set: (next: Perms) => {
      perms = next;
    },
    checkPermissions,
    requestPermissions,
  };
}

/** The app went to the background (Settings) and came back: what lib/app-lifecycle hears. */
function backgroundAndReturn() {
  for (const state of ['hidden', 'visible'] as const) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const draw = () =>
  render(
    <LocaleProvider>
      <PreciseLocationNotice />
    </LocaleProvider>,
  );

afterEach(() => {
  Reflect.deleteProperty(window, 'Capacitor');
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('PreciseLocationNotice', () => {
  it('says the phone is on "Perkiraan" and where to switch it', async () => {
    shell({ location: 'prompt', coarseLocation: 'granted' });
    draw();
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(N.title);
    expect(notice).toHaveTextContent('Gunakan lokasi akurat');
  });

  it('reads a refused precise upgrade the same way', async () => {
    shell({ location: 'denied', coarseLocation: 'granted' });
    draw();
    expect(await screen.findByRole('status')).toHaveTextContent(N.title);
  });

  it('says nothing when precise location is granted', async () => {
    const s = shell({ location: 'granted', coarseLocation: 'granted' });
    draw();
    await waitFor(() => expect(s.checkPermissions).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says nothing when no location is granted at all — that is the dialog’s job', async () => {
    const s = shell({ location: 'prompt', coarseLocation: 'prompt' });
    draw();
    await waitFor(() => expect(s.checkPermissions).toHaveBeenCalled());
    await settle();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says nothing in a browser, where there is no app permission to read', async () => {
    draw();
    await settle();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never asks for a permission itself', async () => {
    const s = shell({ location: 'prompt', coarseLocation: 'granted' });
    draw();
    await screen.findByRole('status');
    expect(s.requestPermissions).not.toHaveBeenCalled();
  });

  it('goes away when the person comes back from Settings with "Tepat" on', async () => {
    const s = shell({ location: 'denied', coarseLocation: 'granted' });
    draw();
    await screen.findByRole('status');
    s.set({ location: 'granted', coarseLocation: 'granted' });
    backgroundAndReturn();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('stops re-checking once the screen is gone', async () => {
    const s = shell({ location: 'denied', coarseLocation: 'granted' });
    const { unmount } = draw();
    await screen.findByRole('status');
    const reads = s.checkPermissions.mock.calls.length;
    unmount();
    backgroundAndReturn();
    await settle();
    expect(s.checkPermissions).toHaveBeenCalledTimes(reads);
  });
});
