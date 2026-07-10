/**
 * Security primitives used by the authentication use-cases. Kept behind a port so
 * the domain/application layers never import a crypto library directly and can be
 * unit-tested with a deterministic fake.
 */
export interface CryptoPort {
  /** Generate a numeric OTP code of the given length (cryptographically random). */
  generateNumericCode(length: number): string;
  /** Generate a high-entropy opaque token (returned to the client, never stored). */
  generateOpaqueToken(): string;
  /** Slow one-way hash for low-entropy secrets (OTP codes) — bcrypt. */
  hashSecret(value: string): Promise<string>;
  /** Constant-time comparison of a plaintext secret against its bcrypt hash. */
  verifySecret(value: string, hash: string): Promise<boolean>;
  /** Deterministic keyed hash (HMAC-SHA256) for high-entropy tokens, so they can be looked up. */
  hashToken(value: string): string;
  /** Generate a UUID (e.g. for refresh-token families). */
  uuid(): string;
}
