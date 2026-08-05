import { decryptVector, encryptVector } from '../../src/infrastructure/crypto/face-vector.cipher';

const KEY = 'a'.repeat(64); // 64 hex chars = a raw 32-byte key
const PASSPHRASE = 'a shorter human-chosen key';

describe('face vector cipher (B-19)', () => {
  it('round-trips a 512-float template exactly', () => {
    const vector = Array.from({ length: 512 }, (_, i) => (i % 7) / 13 - 0.4);
    expect(decryptVector(encryptVector(vector, KEY), KEY)).toEqual(vector);
  });

  it('accepts a passphrase as well as a hex key', () => {
    const vector = [0.25, -0.5, 0.125];
    expect(decryptVector(encryptVector(vector, PASSPHRASE), PASSPHRASE)).toEqual(vector);
  });

  it('produces different ciphertext each time, and none of it resembles the input', () => {
    const vector = [0.25, -0.5];
    const a = encryptVector(vector, KEY);
    const b = encryptVector(vector, KEY);
    expect(a.equals(b)).toBe(false); // fresh IV per write
    expect(a.toString('latin1')).not.toContain('0.25');
  });

  // GCM, not CBC: a tampered or truncated template must fail loudly rather than decrypt to
  // a vector that would then be compared against a live face.
  it('refuses ciphertext that was altered or encrypted under another key', () => {
    const blob = encryptVector([0.25, -0.5], KEY);
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptVector(tampered, KEY)).toThrow();
    expect(() => decryptVector(blob, 'b'.repeat(64))).toThrow();
  });

  // Without a pinned authTagLength, GCM verifies whatever tag length it is handed — so a
  // blob whose 16-byte tag was cut to 4 would still authenticate, at 2^-32 forgery work.
  it('refuses a blob whose authentication tag was truncated', () => {
    const blob = encryptVector([0.25, -0.5], KEY);
    const shortTag = Buffer.concat([blob.subarray(0, 12 + 4), blob.subarray(12 + 16)]);
    expect(() => decryptVector(shortTag, KEY)).toThrow();
  });
});
