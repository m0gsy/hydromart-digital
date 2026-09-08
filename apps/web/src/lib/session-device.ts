'use client';

/**
 * CA-3-57 — which row in the devices list is the phone in your hand.
 *
 * `GET /sessions` answers with every active session and nothing said which one was the
 * caller's, so the dangerous entry and the harmless one looked identical. The person most
 * likely to open that screen is somebody who thinks their account has been taken, deciding
 * which row to revoke; revoking their own signs them out and leaves the intruder in.
 *
 * The ROTATION FAMILY, not the row id: a refresh rotates the row every fifteen minutes, so
 * `id` changes under the client while `familyId` stays put for the life of the device
 * session. auth-service hands it back with the tokens.
 *
 * localStorage rather than the token store: that one is native-only (web keeps its tokens
 * in cookies), and this is needed on both.
 */
const KEY = 'hydromart.session.familyId';

export function rememberSessionFamily(familyId: string | undefined | null): void {
  try {
    if (familyId) localStorage.setItem(KEY, familyId);
  } catch {
    // Private mode or storage disabled. The list then marks nothing, which is exactly the
    // behaviour before this existed — never a wrong mark.
  }
}

export function currentSessionFamily(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetSessionFamily(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to forget if it could not be written either */
  }
}
