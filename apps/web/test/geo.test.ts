import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentPosition, GeoError, geoReason } from '@/lib/geo';

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
