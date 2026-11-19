/**
 * Face plan PR-4: the local face engine (face-service) — the second opinion beside NEO, and
 * later its fallback. The application decides on three answers, never on transport details.
 */
export const LOCAL_FACE_ENGINE = Symbol('LOCAL_FACE_ENGINE');

/** The dimension of a local (SFace) template — what tells it apart from a legacy 512-d one. */
export const LOCAL_TEMPLATE_DIM = 128;

export interface LocalEmbedding {
  /** Unit-length 128-d SFace embedding. */
  vector: number[];
  detScore: number;
}

export interface LocalFaceEngine {
  embed(jpeg: Buffer): Promise<LocalEmbedding>;
}

/** The engine looked and found no face. */
export class LocalNoFaceError extends Error {}

/** The image itself is the problem: unreadable, too small, too large. Retrying the same bytes will not help. */
export class LocalBadImageError extends Error {}

/** No answer: not configured, down, busy, too slow, or an answer it cannot trust. */
export class LocalEngineUnavailableError extends Error {}
