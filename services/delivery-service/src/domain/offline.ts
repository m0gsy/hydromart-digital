import { StaleCaptureError } from './errors';

/**
 * Device-supplied capture time, for work recorded while the courier had no signal.
 *
 * The device clock is the one thing the server cannot re-verify at flush time — GPS, the
 * status transition guard and the proof uniqueness all still run — so it is clamped rather
 * than trusted: never later than the moment it reached us, never earlier than the anchor the
 * work hangs off, and refused outright once it is older than the offline window allows.
 * Returns `now` for live work, which is every caller that passes no capture time.
 */
export function clampCapturedAt(
  capturedAt: Date | null | undefined,
  now: Date,
  maxAgeHours: number,
  floor?: Date | null,
): Date {
  if (!capturedAt) return now;
  if (capturedAt.getTime() < now.getTime() - maxAgeHours * 3_600_000) {
    throw new StaleCaptureError(maxAgeHours);
  }
  const capped = Math.min(capturedAt.getTime(), now.getTime());
  return new Date(floor ? Math.max(capped, floor.getTime()) : capped);
}
