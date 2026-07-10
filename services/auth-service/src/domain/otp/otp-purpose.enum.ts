/** Reason an OTP challenge was issued. Mirrors the Prisma `OtpPurpose` enum. */
export enum OtpPurpose {
  REGISTRATION = 'REGISTRATION',
  LOGIN = 'LOGIN',
}
