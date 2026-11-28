/**
 * Why a native app dropped a session that was still valid server-side. Sent by the app with the
 * next OTP request and written into the login audit metadata, so a billed SMS can be explained.
 */
export const SESSION_DROP_REASONS = [
  'lock_sms',
  'stored_skipped',
  'vault_read_failed',
  'vault_write_failed',
  'vault_empty',
  'unlock_failed',
  'refresh_refused',
  'signed_out',
] as const;

export type SessionDropReason = (typeof SESSION_DROP_REASONS)[number];
