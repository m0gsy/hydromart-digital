'use client';

import { isNativeShell } from './platform';
import { unlockDevice, vaultClear, vaultRead, vaultWrite } from './secure-vault';

/**
 * F2: the native half of the session. F3b: and where it sleeps.
 *
 * On the web the credential is an httpOnly cookie the gateway owns and JavaScript can
 * never read (SEC-4), and every function here is a no-op — no web user's token ever
 * touches this module. Inside the Capacitor WebView that cookie does not exist: the app
 * is served from `https://localhost`, which is cross-site to the API host, so a
 * `sameSite: 'lax'` cookie is never sent. The shell holds the tokens itself and sends
 * them as a bearer.
 *
 * Reads are synchronous and lazy, exactly like `session-store.ts`, because `api.ts` has
 * to be able to answer "do I have a token?" in the middle of building a request. An
 * async store would leave a window at boot where a request goes out unauthenticated,
 * 401s, and signs the user out of an app whose session was fine.
 *
 * At rest the tokens live in the Android Keystore, not in localStorage — F2 shipped with
 * localStorage and said so, and this is the promised replacement. A synchronous read of
 * a Keystore entry does not exist, so nothing is read lazily any more: `unlockTokens()`
 * is awaited once, at boot, before the first request goes out, and it is the only thing
 * that can put a token into memory from disk. That ordering is enforced in
 * `auth-context.tsx`, which will not call `/auth/me` until it resolves.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** Consecutive failed unlock attempts survive an app restart; the token must not outlive them. */
const FAILURE_KEY = 'hm.unlock-failures';

/**
 * Three real mismatches and the stored session is destroyed — the user goes back through
 * OTP, which is the one path that can mint a new one. Never a bypass, never a retry
 * that leaves the token in place: the whole value of the Keystore copy is that a phone
 * in someone else's hands cannot be talked into opening it.
 *
 * Android's own BiometricPrompt locks out after five bad reads, so in practice the OS
 * usually gets there first; this counter is what makes a phone that is repeatedly picked
 * up, failed once, and put down again eventually give up too.
 */
const MAX_UNLOCK_FAILURES = 3;

let tokens: Tokens | null = null;
/** The last vault write, so a caller can wait for the disk before acting on the token. */
let persisting: Promise<void> = Promise.resolve();

function isTokens(value: unknown): value is Tokens {
  const t = value as Partial<Tokens> | null | undefined;
  return typeof t?.accessToken === 'string' && typeof t?.refreshToken === 'string';
}

function parseTokens(raw: string): Tokens | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isTokens(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function failures(): number {
  try {
    return Number(window.localStorage.getItem(FAILURE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function setFailures(count: number): void {
  try {
    if (count === 0) window.localStorage.removeItem(FAILURE_KEY);
    else window.localStorage.setItem(FAILURE_KEY, String(count));
  } catch {
    /* localStorage evicted or unavailable: the OS lockout is still in force */
  }
}

/**
 * Seed the store from a source that could only be read asynchronously, before the first
 * render. `unlockTokens()` is the caller; tests use it directly to place a session.
 */
export function primeTokens(next: Tokens | null): void {
  tokens = next;
}

/**
 * Restore the session from the Keystore, behind the device's own lock. Resolves when the
 * store holds whatever it is going to hold for this launch — the app must not ask the
 * API anything before it does.
 *
 * A device with no screen lock at all restores without a prompt. That is a deliberate
 * decision, not an oversight: refusing would lock those users out of an app that kept
 * them signed in yesterday, and there is nothing to protect on a phone anyone can already
 * open. Everywhere else, the token is only readable after the owner proves it.
 *
 * Cancelling the prompt leaves the vault intact and the app signed out for this launch —
 * dismissing a dialog is not evidence of anything, and destroying a session over it would
 * mean an accidental back-press costs an OTP.
 */
export async function unlockTokens(): Promise<void> {
  if (!isNativeShell()) return;
  const stored = await vaultRead();
  if (!stored) {
    primeTokens(null);
    return;
  }

  const outcome = await unlockDevice('Buka sesi Hydromart Anda');
  if (outcome === 'ok' || outcome === 'unavailable') {
    setFailures(0);
    primeTokens(parseTokens(stored));
    return;
  }

  if (outcome === 'failed') {
    const count = failures() + 1;
    setFailures(count);
    if (count >= MAX_UNLOCK_FAILURES) {
      setFailures(0);
      await vaultClear();
    }
  }
  primeTokens(null);
}

export function getAccessToken(): string | null {
  return tokens?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return tokens?.refreshToken ?? null;
}

/**
 * Whether this client holds a credential of its own.
 *
 * This is what gates a refresh attempt on native, and it is deliberately NOT
 * "is there a cached profile in localStorage". Android clears WebView localStorage on
 * its own schedule — under storage pressure, or when the user clears app data partially
 * — while the Keystore entry survives. Gating on the profile means a user with a
 * perfectly valid 30-day session gets silently signed out because a UX cache was evicted.
 */
export function hasTokens(): boolean {
  return tokens !== null;
}

/**
 * Take the tokens out of a session response, if this is a native client and the body
 * carries any. Returns whether it stored something, so callers can tell a token-bearing
 * response from an ordinary one.
 */
export function captureTokens(body: unknown): boolean {
  if (!isNativeShell() || !isTokens(body)) return false;
  setTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
  return true;
}

export function setTokens(next: Tokens | null): void {
  if (!isNativeShell()) return;
  tokens = next;
  // Writing the Keystore is asynchronous where localStorage was not, so the write is
  // tracked rather than awaited here — `setTokens` is called from inside a synchronous
  // response handler. `tokensPersisted()` is how the one caller that must not run ahead
  // of the disk waits for it.
  persisting = (next ? vaultWrite(JSON.stringify(next)) : vaultClear()).catch(() => {
    /* Keystore unavailable: this session still works from memory until the app closes */
  });
}

/** Resolves once every token written so far is actually on disk. */
export function tokensPersisted(): Promise<void> {
  return persisting;
}

export function clearTokens(): void {
  setFailures(0);
  setTokens(null);
}
