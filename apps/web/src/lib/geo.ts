/**
 * Ask the device for the current position.
 *
 * Every caller used to inline `getCurrentPosition` with `enableHighAccuracy: true` and an
 * eight-second timeout, and report EVERY failure as "izinkan akses lokasi". Two things were
 * wrong with that, and a user hit both:
 *
 * 1. A cold GPS on a real phone does not return in eight seconds. High accuracy asks the
 *    satellites; indoors, or from a standing start, that routinely takes half a minute. The
 *    network provider answers in about a second and is accurate to a few hundred metres —
 *    which is far better than the nearest depot needs. So: try precise, briefly; then fall
 *    back to coarse, patiently. A `maximumAge` on the retry accepts a fix the OS already has.
 * 2. Codes 2 and 3 are not code 1. Telling someone to grant a permission they have already
 *    granted sends them into Settings to find nothing wrong, and it cost this app a bug
 *    report that read as "izin sudah di-allow tapi tetap ditolak". The reason now survives
 *    to the screen, so the message can name what actually happened.
 */
export type GeoFailure =
  /** The permission really was refused — by Android, or by the WebView layer above it. */
  | 'denied'
  /** No provider could produce a fix: location services off, or no signal. */
  | 'unavailable'
  /** Providers are alive but nothing arrived in time. */
  | 'timeout'
  /** No geolocation API at all. */
  | 'unsupported';

export class GeoError extends Error {
  constructor(readonly reason: GeoFailure) {
    super(reason);
    this.name = 'GeoError';
  }
}

/**
 * The reason behind any thrown value, for screens that must show one.
 *
 * Three screens had this ternary inlined and two more had nothing at all — those two put
 * `GeoError.message` on screen, and that message is the reason token itself, so a courier
 * whose GPS was slow read the single word "timeout". One helper, so a caller cannot
 * forget. An unknown throw is a timeout: it is the only reason that invites a retry, and
 * the retry is free.
 */
export const geoReason = (err: unknown): GeoFailure => (err instanceof GeoError ? err.reason : 'timeout');

const ask = (options: PositionOptions): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));

const reasonOf = (err: unknown): GeoFailure => {
  const code = (err as GeolocationPositionError | undefined)?.code;
  if (code === 1) return 'denied';
  if (code === 2) return 'unavailable';
  return 'timeout';
};

export async function currentPosition(): Promise<GeolocationPosition> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    throw new GeoError('unsupported');
  }
  try {
    return await ask({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 });
  } catch (err) {
    // A refusal is final: retrying cannot turn it into a yes, and the second prompt is worse
    // than the first message.
    if (reasonOf(err) === 'denied') throw new GeoError('denied');
    try {
      return await ask({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 300_000 });
    } catch (retry) {
      throw new GeoError(reasonOf(retry));
    }
  }
}
