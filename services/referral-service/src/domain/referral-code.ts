import { randomInt } from 'node:crypto';

// Referral code generation and normalisation (PRD Module 12 FR-092). Codes are short,
// human-shareable, and drawn from an unambiguous uppercase alphanumeric alphabet.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 8;

/**
 * Generate an 8-character uppercase [A-Z0-9] referral code using a cryptographically
 * strong RNG (node:crypto randomInt — never Math.random). Uniqueness is enforced at
 * the persistence layer; callers retry on the rare collision.
 */
export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** Canonical form of a user-supplied code: trimmed and uppercased. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
