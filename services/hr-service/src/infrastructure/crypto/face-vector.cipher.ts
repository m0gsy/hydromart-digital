import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * B-19: face embeddings are biometric data under UU 27/2022 and cannot be reissued after a
 * leak — a stolen 512-float template is that employee's face forever. They used to sit in
 * the table as a plain `Float[]`, readable by anything with a connection string or a
 * backup dump. They are stored as AES-256-GCM ciphertext now.
 *
 * Layout: iv(12) || tag(16) || ciphertext. The plaintext is the raw little-endian Float64
 * buffer of the vector, so the round-trip is exact — a lossy encoding would move cosine
 * scores against the match threshold.
 *
 * ponytail: one key for the whole table, from the environment. Per-employee keys or a KMS
 * only pay off once there is somewhere better than the same host to keep the master key.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Any passphrase becomes a 32-byte key; a hex key is used for what it is. */
function keyFrom(secret: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(secret)) return Buffer.from(secret, 'hex');
  return createHash('sha256').update(secret).digest();
}

export function encryptVector(vector: number[], secret: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const plain = Buffer.from(Float64Array.from(vector).buffer);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptVector(blob: Uint8Array, secret: string): number[] {
  const buf = Buffer.from(blob);
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  const plain = Buffer.concat([
    decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
  // Copy through a fresh ArrayBuffer: a pooled Buffer's byteOffset is rarely 8-aligned,
  // which Float64Array refuses outright.
  return Array.from(new Float64Array(Uint8Array.from(plain).buffer));
}
