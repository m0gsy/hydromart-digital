'use client';

import { onResume } from './app-lifecycle';
import { isNativeShell } from './platform';
import { FAILURES_KEY, unlockDevice, vaultClear, vaultRead, vaultWrite } from './secure-vault';

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

/**
 * How long the app has to have been in the background before the session is put back
 * behind the device lock.
 *
 * Depot phones are shared and get left on counters. Until now a session unlocked at 6am
 * stayed open until the process died, which on Android can be days. Fifteen minutes is
 * long enough that stepping outside to hand over a gallon is not a re-prompt, and short
 * enough that a phone left on a table is not an open session.
 */
const RELOCK_AFTER_MS = 15 * 60_000;

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

/**
 * How long an unlock may go unanswered before the session is called `locked`.
 *
 * Every authenticated request waits on the unlock, so a prompt that is shown and never
 * resolves — the OS tore it down while the app was backgrounded, or the plugin lost the
 * callback — would hold every screen on a spinner for good, with no error and nothing to tap.
 * Long enough for a person to find their glasses; short enough that a dead prompt is not a
 * dead app. A late answer still counts: if the owner does unlock afterwards, the session opens.
 */
const UNLOCK_TIMEOUT_MS = 90_000;

let tokens: Tokens | null = null;
/** The last vault write, so a caller can wait for the disk before acting on the token. */
let persisting: Promise<void> = Promise.resolve();
/** The unlock in flight, or the one already done. See `unlockTokens`. */
let unlocking: Promise<void> | null = null;
/** Whether the last unlock ended because the prompt was dismissed, so a screen can offer another. */
let cancelled = false;
/**
 * An unlock ended without opening the session while the Keystore still holds one: the prompt
 * was dismissed, or it failed fewer than `MAX_UNLOCK_FAILURES` times. The account is NOT signed
 * out — it is waiting for its owner — and every screen has to be told so, because the cached
 * profile in localStorage still says "signed in" and nothing else would.
 */
let lockedOut = false;
/** An unlock finished and found nothing to open: no entry, an unusable one, or one just destroyed. */
let settledEmpty = false;

/**
 * Where the session stands, in the one place anything may ask.
 *
 * Until this existed the store answered only "is there a token?", and a `null` meant three
 * different things — still being read, waiting for its owner, and gone — that call for three
 * different screens. Reading them all as "no token" is how the app ended up rendering every
 * screen for a profile whose token was not in memory, sending each request without a bearer,
 * and showing the gateway's "Missing bearer token" on a session that was never in trouble.
 *
 *  - `pending`: the Keystore has not been read yet this launch (or this return from the
 *    background). Callers wait; they do not decide.
 *  - `open`: a token is in memory (always, on the web, where the cookie is not ours to hold).
 *  - `locked`: a session exists on the device but its owner has not opened it.
 *  - `signedOut`: there is no session to open. Whatever profile a screen still holds is stale.
 */
export type SessionLock = 'pending' | 'open' | 'locked' | 'signedOut';

export function getSessionLock(): SessionLock {
  // On the web the credential is an httpOnly cookie this module never sees, so there is
  // nothing here to be locked or missing.
  if (!isNativeShell()) return 'open';
  if (tokens) return 'open';
  if (lockedOut) return 'locked';
  return settledEmpty ? 'signedOut' : 'pending';
}

type LockListener = (state: SessionLock) => void;
const lockListeners = new Set<LockListener>();
let announced: SessionLock | null = null;

/** Subscribe to changes of `getSessionLock()`. Returns the unsubscribe. */
export function onSessionLockChange(fn: LockListener): () => void {
  lockListeners.add(fn);
  return () => lockListeners.delete(fn);
}

function announce(): void {
  const now = getSessionLock();
  if (now === announced) return;
  announced = now;
  // A copy, so a listener that unsubscribes itself cannot skip the next one.
  for (const fn of [...lockListeners]) fn(now);
}

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

async function failures(): Promise<number> {
  const read = await vaultRead(FAILURES_KEY);
  return read.ok ? Number(read.data) || 0 : 0;
}

async function setFailures(count: number): Promise<void> {
  try {
    if (count === 0) await vaultClear(FAILURES_KEY);
    else await vaultWrite(String(count), FAILURES_KEY);
  } catch {
    /* Keystore unavailable: the OS's own biometric lockout is still in force */
  }
}

/**
 * Seed the store from a source that could only be read asynchronously, before the first
 * render. `unlockTokens()` is the caller; tests use it directly to place a session.
 */
export function primeTokens(next: Tokens | null): void {
  tokens = next;
  if (next) {
    lockedOut = false;
    settledEmpty = false;
  }
  announce();
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
export function unlockTokens(): Promise<void> {
  if (!isNativeShell()) return Promise.resolve();
  // Single-flight and permanent. Every authenticated request waits on this promise, and
  // the first one to arrive starts it — so it does not matter whether the app boots into
  // a screen that fetches immediately or one that does not, and there is no ordering
  // between `AuthProvider` and the rest of the tree to get wrong. Kept after it resolves
  // because a second unlock would be a second biometric prompt for a session that is
  // already open, including right after a sign-out.
  unlocking ??= restoreWithin(UNLOCK_TIMEOUT_MS);
  return unlocking;
}

/**
 * Whether the stored session is sitting there unopened because the prompt was dismissed.
 *
 * Dismissing deliberately does not destroy anything — but until now it also left no way
 * back, because `unlocking` is remembered for the life of the process. One stray
 * back-press therefore cost an OTP, which is the exact outcome `unlockTokens` says it
 * exists to avoid. A screen that can see this can offer the prompt again.
 */
export function unlockWasCancelled(): boolean {
  return cancelled;
}

/** Ask again, after a dismissal. The only thing allowed to forget a finished unlock. */
export function retryUnlock(): Promise<void> {
  cancelled = false;
  lockedOut = false;
  unlocking = null;
  announce();
  return unlockTokens();
}

function restoreWithin(ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unanswered = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      if (tokens === null && !settledEmpty) {
        lockedOut = true;
        announce();
      }
      resolve();
    }, ms);
  });
  return Promise.race([restoreFromVault(), unanswered]).finally(() => clearTimeout(timer));
}

async function restoreFromVault(): Promise<void> {
  // A session already established this launch needs no unlocking, and must not be
  // overwritten by what happens to be on disk. The case that matters is the one right
  // after an OTP login: the tokens are in memory, the first authenticated request
  // arrives, and without this it would raise a biometric prompt to re-open a session the
  // user opened thirty seconds ago with a code from an SMS.
  if (tokens) return;
  cancelled = false;
  lockedOut = false;
  settledEmpty = false;

  // Whatever way this ends, the answer is announced exactly once, after the flags are final.
  try {
    const read = await vaultRead();
    // A read that failed is a key the device can no longer use — Android invalidates one
    // when a new fingerprint is enrolled. Leaving the entry in place would mean a prompt
    // on every launch for a blob that can never be decrypted again, so it goes, and the
    // user signs in once with an OTP. Deliberately not done for `unavailable`, which is a
    // missing plugin rather than a broken key.
    if (!read.ok) {
      if (read.code !== 'unavailable') await vaultClear();
      settledEmpty = true;
      primeTokens(null);
      return;
    }
    if (read.data === null) {
      settledEmpty = true;
      primeTokens(null);
      return;
    }

    const outcome = await unlockDevice('Buka sesi Hydromart Anda');
    if (outcome === 'ok' || outcome === 'unavailable') {
      await setFailures(0);
      const restored = parseTokens(read.data);
      // An entry that opened but holds nothing usable is as good as none: nothing will ever
      // read it, and calling it "locked" would offer a prompt that can never succeed.
      if (!restored) settledEmpty = true;
      primeTokens(restored);
      return;
    }

    cancelled = outcome === 'cancelled';
    if (outcome === 'failed') {
      const count = (await failures()) + 1;
      await setFailures(count);
      if (count >= MAX_UNLOCK_FAILURES) {
        await setFailures(0);
        await vaultClear();
        settledEmpty = true;
        primeTokens(null);
        return;
      }
    }
    // The session is intact and its owner has not opened it.
    lockedOut = true;
    primeTokens(null);
  } catch {
    // Reaching here means the vault or the prompt threw something the plugin layer did not
    // classify. The entry is untouched, so the honest state is "waiting for its owner" — never
    // an unexplained null, which is what let the app render screens with no token behind them.
    lockedOut = true;
    primeTokens(null);
  }
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
  // A token written means a session is open; one cleared means the account was signed out,
  // which is "nothing to open" rather than "still being read".
  lockedOut = false;
  settledEmpty = next === null;
  announce();
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
  void setFailures(0);
  setTokens(null);
}

/**
 * Put an open session back behind the device lock after a long absence.
 *
 * `tokens = null` and not `setTokens(null)`: the second one wipes the vault, which would
 * turn "prove it is still you" into "sign in with an OTP again" — the opposite of the
 * point. Clearing `unlocking` re-arms the prompt, and the listener below raises it straight
 * away.
 */
if (typeof window !== 'undefined') {
  onResume((awayMs) => {
    if (!isNativeShell() || awayMs < RELOCK_AFTER_MS || tokens === null) return;
    tokens = null;
    unlocking = null;
    cancelled = false;
    lockedOut = false;
    settledEmpty = false;
    announce();
    // Ask NOW rather than leaving it to whichever request arrives first. The prompt used to
    // appear in the middle of a fetch the user had not asked for, and a dismissal there left
    // that fetch and everything after it to go out with no token at all. Asked here, a
    // dismissal lands in `locked`, which every screen can see and offer a way out of.
    void unlockTokens();
  });
}
