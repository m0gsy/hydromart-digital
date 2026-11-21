import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

export const FACE_VERIFIER = Symbol('FACE_VERIFIER');

/**
 * The engine could not be ASKED: quota spent, provider down, a timeout. Nothing the employee
 * sent causes it, and no misconfiguration does either (those stay a plain 503 that pages).
 * Attendance holds such a punch PENDING for HR instead of refusing it (owner, 2026-11-18).
 */
export class FaceEngineUnavailableError extends ServiceUnavailableException {}

/**
 * The engine answered, and holds no face for this employee, though HR has an active enrolment
 * for them. Seen 2026-11-21: NEO answered "UserID Not Found" for people it had verified the day
 * before, and every one of their punches was a 503 that paged ops while the employee read an
 * engine error. Not an outage, not the frame, nothing the employee did: the enrolment itself is
 * gone. Attendance keeps the punch for HR and retires HR's copy, so the app asks for a new one.
 * Anywhere it is not caught it is a 400 that says so.
 */
export class FaceNotEnrolledError extends BadRequestException {
  constructor() {
    super('Wajah Anda tidak ditemukan di sistem absen. Daftar ulang wajah, lalu absen lagi.');
  }
}

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
  /**
   * Server-side passive-liveness verdict. `undefined` means it was not asked (the driver has
   * none, or it is switched off); `false` is a presentation attack the face match alone
   * would have let through (a photo of a photo, a screen).
   */
  live?: boolean;
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
   *
   * There is deliberately no liveness ARGUMENT. The verdict used to arrive as a boolean in
   * the punch request body, which any crafted request could set to true — a check an
   * attacker fills in themselves is not a check. Liveness is now decided by the provider
   * from the same frame (`FaceVerifyResult.live`), never by the caller.
   */
  verify(image: Buffer, enrolled: number[][], identity?: FaceIdentity): Promise<FaceVerifyResult>;
  /**
   * Delete whatever the engine itself holds for one employee. Only a REMOTE gallery (neo) has
   * anything to delete — the local drivers keep nothing outside our own table, which the face
   * service already clears — so they leave this out. Resolves when the face is gone, including
   * when it was never there; throws when the engine could not be reached or refused.
   */
  remove?(identity: FaceIdentity): Promise<void>;
}
