import { afterEach, describe, expect, it, vi } from 'vitest';

import { approximateOnly, currentPosition, GeoError, geoReason } from '@/lib/geo';

/**
 * J1 — `lib/geo.ts` shipped with zero direct coverage, and the bug that closed it lived in
 * the one branch nobody could see: code 1 is never retried, which is right for a real
 * refusal and was wrong when the manifest manufactured the refusal.
 *
 * The native side of J1 cannot be tested here — the e2e suite grants location through
 * Playwright and so deletes the entire permission layer the bug lived in. What IS testable
 * is the contract every caller depends on: which failure survives to the screen, and which
 * of the two legs produced it.
 */
const position = (lat: number): GeolocationPosition =>
  ({ coords: { latitude: lat, longitude: 1 } }) as GeolocationPosition;

const fail = (code: number) => ({ code }) as GeolocationPositionError;

/** Installs a `navigator.geolocation` whose calls resolve/reject in the given order. */
function withGeolocation(...legs: (GeolocationPosition | GeolocationPositionError)[]) {
  const calls: PositionOptions[] = [];
  const getCurrentPosition = vi.fn(
    (ok: PositionCallback, err: PositionErrorCallback | null, options?: PositionOptions) => {
      calls.push(options ?? {});
      const leg = legs[calls.length - 1];
      if (leg && 'coords' in leg) ok(leg);
      else err?.(leg as GeolocationPositionError);
    },
  );
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  return { calls, leg: (i: number): PositionOptions => calls[i] ?? {} };
}

afterEach(() => vi.unstubAllGlobals());

describe('currentPosition', () => {
  it('returns the precise fix without ever asking for a coarse one', async () => {
    const { calls, leg } = withGeolocation(position(-6.9));
    await expect(currentPosition()).resolves.toMatchObject({ coords: { latitude: -6.9 } });
    expect(calls).toHaveLength(1);
    expect(leg(0).enableHighAccuracy).toBe(true);
  });

  it('falls back to the coarse leg when the precise one times out, and returns its fix', async () => {
    const { calls, leg } = withGeolocation(fail(3), position(-7.1));
    await expect(currentPosition()).resolves.toMatchObject({ coords: { latitude: -7.1 } });
    expect(calls).toHaveLength(2);
    expect(leg(1).enableHighAccuracy).toBe(false);
    // The retry must be patient and must accept an older fix, or it is the first leg again.
    expect(leg(1).timeout).toBeGreaterThan(leg(0).timeout as number);
    expect(leg(1).maximumAge).toBeGreaterThan(leg(0).maximumAge as number);
  });

  it('does not retry a refusal — code 1 is final', async () => {
    const { calls } = withGeolocation(fail(1), position(-7.1));
    await expect(currentPosition()).rejects.toMatchObject({ reason: 'denied' });
    expect(calls).toHaveLength(1);
  });

  it.each([
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('reports code %i from the coarse leg as %s', async (code, reason) => {
    withGeolocation(fail(3), fail(code));
    await expect(currentPosition()).rejects.toMatchObject({ reason });
  });

  it('reports a refusal that only arrives on the coarse leg as denied', async () => {
    withGeolocation(fail(2), fail(1));
    await expect(currentPosition()).rejects.toMatchObject({ reason: 'denied' });
  });

  it('is unsupported when the device has no geolocation at all', async () => {
    vi.stubGlobal('navigator', {});
    await expect(currentPosition()).rejects.toMatchObject({ reason: 'unsupported' });
  });
});

describe('geoReason', () => {
  it('reads the reason off a GeoError', () => {
    expect(geoReason(new GeoError('denied'))).toBe('denied');
    expect(geoReason(new GeoError('unsupported'))).toBe('unsupported');
  });

  it('calls anything else a timeout — the only reason worth retrying', () => {
    expect(geoReason(new Error('boom'))).toBe('timeout');
    expect(geoReason(undefined)).toBe('timeout');
  });
});

/*
 * The native leg, added 2 September 2026 after three screens on a real OPPO spent 28
 * seconds each arriving at "Sinyal lokasi belum ketemu".
 *
 * `navigator.geolocation` inside an Android WebView is Chromium's implementation, not the
 * platform's, and its network provider — the only one a coarse-only permission can use —
 * frequently cannot answer in a WebView at all. The customer binary then declared only
 * ACCESS_COARSE_LOCATION, so there was no working path left: the request ran out the clock
 * whether or not the phone knew where it was. (It declares FINE too since 2026-11-20, but a
 * person can still grant only the approximate one.)
 *
 * What is testable here is the contract: the shell is asked first, a phone that answers is
 * believed, and every way the plugin can let us down falls through to the web API rather
 * than becoming a worse failure than not having tried.
 */
describe('currentPosition inside the native shell', () => {
  /** A `window.Capacitor` whose Geolocation plugin answers with the given implementations. */
  function withPlugin(impl: Record<string, (o?: unknown) => Promise<unknown>>) {
    vi.stubGlobal('window', { Capacitor: { Plugins: { Geolocation: impl } } });
  }

  const granted = { location: 'granted', coarseLocation: 'granted' };

  it('takes the native fix and never touches the web API', async () => {
    const { calls } = withGeolocation(position(-1));
    withPlugin({
      checkPermissions: () => Promise.resolve(granted),
      getCurrentPosition: () =>
        Promise.resolve({ coords: { latitude: -6.25, longitude: 106.99, accuracy: 480 }, timestamp: 7 }),
    });

    await expect(currentPosition()).resolves.toMatchObject({
      coords: { latitude: -6.25, longitude: 106.99, accuracy: 480 },
    });
    // The whole point: the web API is the thing that could not answer.
    expect(calls).toHaveLength(0);
  });

  it('asks for permission when it does not have it yet', async () => {
    const asked: string[] = [];
    withPlugin({
      checkPermissions: () => {
        asked.push('check');
        return Promise.resolve({ location: 'prompt', coarseLocation: 'prompt' });
      },
      requestPermissions: () => {
        asked.push('request');
        return Promise.resolve({ location: 'denied', coarseLocation: 'granted' });
      },
      getCurrentPosition: () =>
        Promise.resolve({ coords: { latitude: -6.3, longitude: 107, accuracy: 900 }, timestamp: 1 }),
    });

    // Coarse alone is a position — what a person who granted only "approximate" holds.
    await expect(currentPosition()).resolves.toMatchObject({ coords: { latitude: -6.3 } });
    expect(asked).toEqual(['check', 'request']);
  });

  it('reports a real refusal as denied, without falling back', async () => {
    const { calls } = withGeolocation(position(-1));
    withPlugin({
      checkPermissions: () => Promise.resolve({ location: 'prompt', coarseLocation: 'prompt' }),
      requestPermissions: () => Promise.resolve({ location: 'denied', coarseLocation: 'denied' }),
    });

    // The OS dialog was shown and answered. Retrying through the web API would only ask
    // Chromium to re-derive the same no.
    await expect(currentPosition()).rejects.toMatchObject({ reason: 'denied' });
    expect(calls).toHaveLength(0);
  });

  it('falls through to the web API when there is no plugin at all', async () => {
    const { calls } = withGeolocation(position(-6.9));
    vi.stubGlobal('window', {});
    await expect(currentPosition()).resolves.toMatchObject({ coords: { latitude: -6.9 } });
    expect(calls).toHaveLength(1);
  });

  it('falls through when the plugin is there and cannot produce a fix', async () => {
    const { calls } = withGeolocation(position(-6.9));
    withPlugin({
      checkPermissions: () => Promise.resolve(granted),
      getCurrentPosition: () => Promise.reject(new Error('location unavailable')),
    });
    // An older binary, a phone with location services off, a plugin that threw: none of
    // them may end worse than the path that existed before the plugin did.
    await expect(currentPosition()).resolves.toMatchObject({ coords: { latitude: -6.9 } });
    expect(calls).toHaveLength(1);
  });

  it('falls through when the plugin answers without coordinates', async () => {
    const { calls } = withGeolocation(position(-6.9));
    withPlugin({
      checkPermissions: () => Promise.resolve(granted),
      getCurrentPosition: () => Promise.resolve({ timestamp: 3 }),
    });
    await expect(currentPosition()).resolves.toMatchObject({ coords: { latitude: -6.9 } });
    expect(calls).toHaveLength(1);
  });
});

/*
 * A presence check — shift check-in, attendance, proof of delivery — is measured against a
 * 100 m fence. The default fix is coarse and may be five minutes old, so a courier standing
 * in the depot was told "526 m from the depot". `precise` asks the GPS and refuses old fixes.
 */
describe('currentPosition({ precise: true })', () => {
  it('asks the native plugin for a fresh high-accuracy fix', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('window', {
      Capacitor: {
        Plugins: {
          Geolocation: {
            checkPermissions: () => Promise.resolve({ location: 'granted', coarseLocation: 'granted' }),
            getCurrentPosition: (o?: unknown) => {
              seen.push(o);
              return Promise.resolve({ coords: { latitude: -6.2, longitude: 106.8 } });
            },
          },
        },
      },
    });
    await currentPosition({ precise: true });
    expect(seen[0]).toMatchObject({ enableHighAccuracy: true });
    expect((seen[0] as PositionOptions).maximumAge).toBeLessThanOrEqual(10_000);
  });

  it('keeps the default coarse request for everything else', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('window', {
      Capacitor: {
        Plugins: {
          Geolocation: {
            checkPermissions: () => Promise.resolve({ coarseLocation: 'granted' }),
            getCurrentPosition: (o?: unknown) => {
              seen.push(o);
              return Promise.resolve({ coords: { latitude: -6.2, longitude: 106.8 } });
            },
          },
        },
      },
    });
    await currentPosition();
    expect(seen[0]).toMatchObject({ enableHighAccuracy: false });
  });

  it('never accepts an old fix in the browser, not even on the fallback leg', async () => {
    const { leg } = withGeolocation(fail(3), position(-7.1));
    await currentPosition({ precise: true });
    expect(leg(0).enableHighAccuracy).toBe(true);
    expect(leg(0).maximumAge).toBeLessThanOrEqual(10_000);
    expect(leg(1).maximumAge).toBeLessThanOrEqual(10_000);
  });
});

/*
 * 2026-11-23: Galaxy and Pekayon punches were refused at 1777 m. Their phones held only
 * "Perkiraan", which Android snaps to a 2 km grid, and a presence check began asking for the
 * precise upgrade itself.
 *
 * 2026-11-25: 44 of the 56 staff who punched that week were still on the grid. The plugin's own
 * `getCurrentPosition` already asks for the upgrade whenever `enableHighAccuracy` is set and
 * FINE is not granted (@capacitor/geolocation 8.2.2: `getAlias` picks the `location` alias, and
 * `handlePermissionRequest` requests it). So every tap put up TWO dialogs, and two "keep
 * approximate" answers make Android stop asking for good. The plugin's single request is the
 * only one now: JS asks nothing of a coarse-only phone, in any mode.
 */
describe('the precise upgrade on a coarse-only phone', () => {
  const coarseOnly = { location: 'denied', coarseLocation: 'granted' };

  /** A shell whose permission check answers `state`; records every JS request and fix options. */
  function withPermissions(state: Record<string, string>) {
    const asked: unknown[] = [];
    const fixes: unknown[] = [];
    vi.stubGlobal('window', {
      Capacitor: {
        Plugins: {
          Geolocation: {
            checkPermissions: () => Promise.resolve(state),
            requestPermissions: (o?: unknown) => {
              asked.push(o);
              return Promise.resolve(state);
            },
            getCurrentPosition: (o?: unknown) => {
              fixes.push(o);
              return Promise.resolve({
                coords: { latitude: -6.27, longitude: 106.96, accuracy: 2000 },
                timestamp: 1,
              });
            },
          },
        },
      },
    });
    return { asked, fixes };
  }

  it('asks nothing from JS: the precise fix itself carries the one upgrade request', async () => {
    const { asked, fixes } = withPermissions(coarseOnly);
    await expect(currentPosition({ precise: true })).resolves.toMatchObject({
      coords: { latitude: -6.27, accuracy: 2000 },
    });
    expect(asked).toEqual([]);
    // enableHighAccuracy is what makes the plugin ask for FINE — exactly once, natively.
    expect(fixes).toEqual([expect.objectContaining({ enableHighAccuracy: true })]);
  });

  it('asks nothing when precise location is already granted', async () => {
    const { asked } = withPermissions({ location: 'granted', coarseLocation: 'granted' });
    await currentPosition({ precise: true });
    expect(asked).toEqual([]);
  });

  it.each([
    ['coarse', {}],
    ['pin', { pin: true }],
  ])('asks nothing in %s mode', async (_mode, options) => {
    const { asked } = withPermissions(coarseOnly);
    await expect(currentPosition(options)).resolves.toMatchObject({ coords: { latitude: -6.27 } });
    expect(asked).toEqual([]);
  });

  it('keeps the native fix: a coarse-only phone is not sent to the web API', async () => {
    const { calls } = withGeolocation(position(-1));
    withPermissions(coarseOnly);
    await expect(currentPosition({ precise: true })).resolves.toMatchObject({ coords: { latitude: -6.27 } });
    expect(calls).toHaveLength(0);
  });
});

/*
 * What the check-in screens show a phone on "Perkiraan" (2026-11-25). It reads the permission
 * and never asks for one: the dialog belongs to the fix, and a second one burns Android's limit.
 */
describe('approximateOnly', () => {
  function withCheck(check: () => Promise<unknown>) {
    const requestPermissions = vi.fn(() => Promise.resolve({}));
    vi.stubGlobal('window', {
      Capacitor: { Plugins: { Geolocation: { checkPermissions: check, requestPermissions } } },
    });
    return requestPermissions;
  }

  it.each([
    [{ location: 'prompt', coarseLocation: 'granted' }],
    [{ location: 'denied', coarseLocation: 'granted' }],
    [{ location: 'prompt-with-rationale', coarseLocation: 'granted' }],
  ])('is true when the app holds coarse location and not fine: %j', async (state) => {
    const requestPermissions = withCheck(() => Promise.resolve(state));
    await expect(approximateOnly()).resolves.toBe(true);
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it.each([
    [{ location: 'granted', coarseLocation: 'granted' }],
    [{ location: 'prompt', coarseLocation: 'prompt' }],
    [{ location: 'denied', coarseLocation: 'denied' }],
    [{}],
  ])('is false otherwise: %j', async (state) => {
    withCheck(() => Promise.resolve(state));
    await expect(approximateOnly()).resolves.toBe(false);
  });

  it('is false wherever it cannot tell: a browser, location services off, an empty answer', async () => {
    vi.stubGlobal('window', {});
    await expect(approximateOnly()).resolves.toBe(false);
    withCheck(() => Promise.reject(Object.assign(new Error('Location services are not enabled.'), { code: 'OS-PLUG-GLOC-0007' })));
    await expect(approximateOnly()).resolves.toBe(false);
    withCheck(() => Promise.resolve(undefined));
    await expect(approximateOnly()).resolves.toBe(false);
  });
});
