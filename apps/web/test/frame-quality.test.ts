import { describe, expect, it } from 'vitest';

import { FRAME_CONTRAST_MIN, frameContrast } from '@/lib/frame-quality';

/**
 * The on-device face capture gate (B-7: the server's face match is the control). Since
 * 2026-11-25 it asks one thing of a frame — that it is not black, covered or washed out — and
 * no longer asks the person to move: a blink never cleared the old motion bar on a 64×64
 * sample, and the frame it sent was taken mid-movement.
 */
describe('frameContrast', () => {
  const frame = (fill: (i: number) => number, n = 64 * 64) =>
    Uint8ClampedArray.from({ length: n }, (_, i) => fill(i));

  it('scores a black frame and a covered lens as no contrast at all', () => {
    expect(frameContrast(frame(() => 0))).toBe(0);
    expect(frameContrast(frame(() => 37))).toBe(0);
    expect(frameContrast(frame(() => 0))).toBeLessThan(FRAME_CONTRAST_MIN);
  });

  it('scores a frame with a scene in it well above the bar', () => {
    // Half dark, half light: the extreme of what a face in front of a wall looks like.
    const scene = frame((i) => (i % 2 === 0 ? 40 : 200));
    expect(frameContrast(scene)).toBeCloseTo(80, 5);
    expect(frameContrast(scene)).toBeGreaterThanOrEqual(FRAME_CONTRAST_MIN);
  });

  it('is the standard deviation of the gray levels', () => {
    // 2, 4, 4, 4, 5, 5, 7, 9: the textbook population standard deviation of 2.
    expect(frameContrast(Uint8ClampedArray.from([2, 4, 4, 4, 5, 5, 7, 9]))).toBe(2);
  });

  it('answers 0, not NaN, for an empty sample', () => {
    expect(frameContrast(new Uint8ClampedArray(0))).toBe(0);
  });

  it('keeps the bar the old gate used for contrast, so no frame it accepted is refused now', () => {
    expect(FRAME_CONTRAST_MIN).toBe(12);
  });
});
