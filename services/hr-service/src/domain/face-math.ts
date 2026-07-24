// Pure face-embedding math. No I/O, no framework — the real matching logic behind
// enroll dup-check (face.service) and 1:N verify (onnx/stub verifiers). Fully unit-tested.

/** Cosine similarity of two equal-length vectors, in [-1, 1] (ArcFace embeddings land in [0, 1]). */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error('cosineSimilarity: vectors must be non-empty and equal length');
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** L2-normalize a vector (unit length). Zero vector maps to itself. */
export function l2normalize(v: readonly number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  const norm = Math.sqrt(n);
  return norm === 0 ? [...v] : v.map((x) => x / norm);
}

/** Element-wise mean of N equal-length vectors, then L2-normalized (frame averaging). */
export function meanNormalize(vectors: readonly (readonly number[])[]): number[] {
  if (vectors.length === 0) throw new Error('meanNormalize: no vectors');
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) throw new Error('meanNormalize: ragged vectors');
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  return l2normalize(sum.map((s) => s / vectors.length));
}

/** Highest-scoring enrolled vector for a probe. Empty set → score 0, index -1. */
export function bestMatch(
  probe: readonly number[],
  enrolled: readonly (readonly number[])[],
): { score: number; index: number } {
  let best = { score: 0, index: -1 };
  for (let i = 0; i < enrolled.length; i++) {
    const score = cosineSimilarity(probe, enrolled[i]);
    if (score > best.score || best.index === -1) best = { score, index: i };
  }
  return best;
}
