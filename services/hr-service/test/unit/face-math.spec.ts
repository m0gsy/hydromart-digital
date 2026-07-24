import { bestMatch, cosineSimilarity, l2normalize, meanNormalize } from '../../src/domain/face-math';

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
