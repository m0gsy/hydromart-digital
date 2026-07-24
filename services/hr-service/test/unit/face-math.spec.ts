import { bestMatch, cosineSimilarity, l2normalize, meanNormalize, rgbToNchw } from '../../src/domain/face-math';

describe('rgbToNchw (ArcFace preprocessing)', () => {
  it('packs interleaved RGB into planar NCHW with (v-127.5)/128 normalization', () => {
    // 1×1 image: one RGB pixel [255, 127.5→127, 0].
    const out = rgbToNchw([255, 127, 0], 1);
    expect(out.length).toBe(3);
    expect(out[0]).toBeCloseTo((255 - 127.5) / 128); // R plane
    expect(out[1]).toBeCloseTo((127 - 127.5) / 128); // G plane
    expect(out[2]).toBeCloseTo((0 - 127.5) / 128); // B plane
  });

  it('separates channels into contiguous planes for a 2×2 image', () => {
    const rgb = new Uint8Array(2 * 2 * 3).fill(128);
    const out = rgbToNchw(rgb, 2);
    expect(out.length).toBe(12); // 3 planes × 4 px
    expect(Array.from(out).every((v) => Math.abs(v - (128 - 127.5) / 128) < 1e-6)).toBe(true);
  });

  it('rejects a buffer whose length does not match the declared size', () => {
    expect(() => rgbToNchw([1, 2, 3], 2)).toThrow(/expected 12 bytes/);
  });
});

describe('face-math', () => {
  it('cosineSimilarity: identical = 1, orthogonal = 0', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1); // same direction, diff magnitude
  });

  it('cosineSimilarity: rejects ragged/empty vectors', () => {
    expect(() => cosineSimilarity([1, 2], [1])).toThrow();
    expect(() => cosineSimilarity([], [])).toThrow();
  });

  it('cosineSimilarity: zero vector scores 0, never NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('l2normalize yields a unit vector (zero stays zero)', () => {
    const n = l2normalize([3, 4]);
    expect(Math.hypot(...n)).toBeCloseTo(1);
    expect(l2normalize([0, 0])).toEqual([0, 0]);
  });

  it('meanNormalize averages frames then normalizes', () => {
    const m = meanNormalize([
      [1, 0],
      [0, 1],
    ]);
    expect(Math.hypot(...m)).toBeCloseTo(1);
    expect(m[0]).toBeCloseTo(m[1]);
    expect(() => meanNormalize([])).toThrow();
    expect(() => meanNormalize([[1, 2], [1]])).toThrow();
  });

  it('bestMatch returns the highest-scoring index; empty set → -1', () => {
    const probe = [1, 0, 0];
    const best = bestMatch(probe, [
      [0, 1, 0],
      [0.9, 0.1, 0],
    ]);
    expect(best.index).toBe(1);
    expect(best.score).toBeGreaterThan(0.9);
    expect(bestMatch(probe, [])).toEqual({ score: 0, index: -1 });
  });
});
