/** Reason an OTP challenge was issued. Mirrors the Prisma `OtpPurpose` enum. */
export enum OtpPurpose {
  REGISTRATION = 'REGISTRATION',
  LOGIN = 'LOGIN',
  /**
   * K1.4: proving control of a NEW number before it becomes the login identity. The only
   * purpose whose code is delivered somewhere other than the account's own number, which
   * is exactly why it cannot share LOGIN's purpose — a code issued for one would otherwise
   * be spendable on the other.
   */
  PHONE_CHANGE = 'PHONE_CHANGE',
}
