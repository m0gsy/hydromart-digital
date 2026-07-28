export const FACE_VERIFIER = Symbol('FACE_VERIFIER');

export interface FaceEmbeddingResult {
  /** L2-normalized 512-d ArcFace embedding (mean of the enrolled frames). */
  vector: number[];
  /** 0..1 detector confidence / sharpness gate; low quality is rejected upstream. */
  quality: number;
}

export interface FaceVerifyResult {
  /** Best cosine similarity (0..1) of the probe against the enrolled set. */
  score: number;
  /** score >= faceMatchThreshold. */
  matched: boolean;
  /** Passive-liveness verdict (client challenge + server sanity check). */
  live: boolean;
}

/**
 * Subject identity for a remote face gallery (NEO/RisetAI). Local drivers (onnx/stub)
 * ignore it; the NEO provider keys enroll/verify on `userId` (= Employee.id).
 */
export interface FaceIdentity {
  userId: string;
  userName: string;
}

/**
 * Face embedding + 1:N match. The production binding is ONNX ArcFace in-process
 * (OnnxArcFaceVerifier); a deterministic StubFaceVerifier serves dev/test
 * (FACE_VERIFIER_DRIVER=stub). Swappable to a remote GPU service (http) later —
 * the application only ever depends on this port.
 */
export interface FaceVerifier {
  /**
   * Enroll N aligned frames into one averaged, normalized embedding. Remote drivers (neo)
   * return an empty `vector` (identity lives in the gallery, keyed by `identity.userId`).
   */
  enroll(images: Buffer[], identity?: FaceIdentity): Promise<FaceEmbeddingResult>;
  /**
   * Match one aligned probe frame against an employee's enrolled faces. Local drivers use
   * `enrolled` vectors; remote drivers (neo) ignore them and verify 1:1 by `identity.userId`.
   */
  verify(
    image: Buffer,
    enrolled: number[][],
    live: boolean,
    identity?: FaceIdentity,
  ): Promise<FaceVerifyResult>;
}
