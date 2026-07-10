import { InvalidPhoneNumberError } from '../errors/auth.errors';

/**
 * Indonesian mobile phone number, normalized to E.164 (+62…).
 *
 * Accepts the common local input forms and canonicalizes them:
 *   08123456789   → +628123456789
 *   628123456789  → +628123456789
 *   +628123456789 → +628123456789
 *
 * Indonesian mobile numbers start with the national prefix "8" after the country
 * code; the national significant number is 9–12 digits (so total after +62 is
 * 9–12 digits). Landlines and non-ID numbers are rejected — the MVP only serves
 * Indonesian customers (documented assumption; revisit for international rollout).
 */
export class PhoneNumber {
  private static readonly E164_PATTERN = /^\+628\d{7,11}$/;

  private constructor(public readonly value: string) {}

  static create(raw: string): PhoneNumber {
    if (typeof raw !== 'string') {
      throw new InvalidPhoneNumberError(String(raw));
    }

    // Strip spaces, dashes, dots and parentheses.
    const cleaned = raw.replace(/[\s\-().]/g, '');
    const normalized = PhoneNumber.toE164(cleaned);

    if (!PhoneNumber.E164_PATTERN.test(normalized)) {
      throw new InvalidPhoneNumberError(raw);
    }
    return new PhoneNumber(normalized);
  }

  private static toE164(cleaned: string): string {
    if (cleaned.startsWith('+62')) {
      return cleaned;
    }
    if (cleaned.startsWith('62')) {
      return `+${cleaned}`;
    }
    if (cleaned.startsWith('0')) {
      return `+62${cleaned.slice(1)}`;
    }
    if (cleaned.startsWith('8')) {
      return `+62${cleaned}`;
    }
    // Anything else is not a recognizable local form.
    return cleaned;
  }

  equals(other: PhoneNumber): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
