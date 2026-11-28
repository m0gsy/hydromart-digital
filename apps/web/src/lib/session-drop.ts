import { isNativeShell } from './platform';

/**
 * Why the Capacitor app dropped a session the server still considered valid.
 *
 * The server cannot tell: prod showed most staff OTP logins arriving while the previous session
 * on the same phone was still alive upstream, and each one is a billed SMS. The app leaves a
 * one-word marker where it drops a session and sends it with the next OTP request, so the audit
 * trail can say why. Same eight words as `SESSION_DROP_REASONS` in auth-service.
 *
 * Every function is a no-op outside the native shell and none can throw: this is diagnostics,
 * and diagnostics must never be the reason somebody cannot sign in.
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

const DROP_KEY = 'hm_session_drop';
const HAD_KEY = 'hm_had_session';

/** Record a drop. The last reason wins, except `vault_empty`, which only guesses when nothing else is known. */
export function noteSessionDrop(reason: SessionDropReason): void {
  if (!isNativeShell()) return;
  try {
    if (reason === 'vault_empty' && localStorage.getItem(DROP_KEY)) return;
    localStorage.setItem(DROP_KEY, reason);
  } catch {
    /* storage unavailable: no marker, no harm */
  }
}

export function peekSessionDrop(): SessionDropReason | null {
  if (!isNativeShell()) return null;
  try {
    const value = localStorage.getItem(DROP_KEY);
    return (SESSION_DROP_REASONS as readonly string[]).includes(value ?? '')
      ? (value as SessionDropReason)
      : null;
  } catch {
    return null;
  }
}

export function clearSessionDrop(): void {
  if (!isNativeShell()) return;
  try {
    localStorage.removeItem(DROP_KEY);
  } catch {
    /* see above */
  }
}

/** This device has held a session before, so an empty Keystore is a loss rather than a first run. */
export function markHadSession(): void {
  if (!isNativeShell()) return;
  try {
    localStorage.setItem(HAD_KEY, '1');
  } catch {
    /* see above */
  }
}

export function hadSession(): boolean {
  if (!isNativeShell()) return false;
  try {
    return localStorage.getItem(HAD_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * An OTP verify that opened a session: the old marker has done its job and the device now has
 * (or is about to have) a session worth detecting the loss of. `before` is the marker read just
 * ahead of the verify; a marker written DURING it (the Keystore refusing the new session) is
 * about the new session and stays.
 */
export function completeLogin(before: SessionDropReason | null): void {
  if (peekSessionDrop() === before) clearSessionDrop();
  markHadSession();
}

/** The request-body field for the pending marker, or nothing: spread it into the login body. */
export function sessionDropField(): { sessionDrop?: SessionDropReason } {
  const sessionDrop = peekSessionDrop();
  return sessionDrop ? { sessionDrop } : {};
}
