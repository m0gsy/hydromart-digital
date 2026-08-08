'use client';

import { isNativeShell } from './platform';

/**
 * F2: the native half of the session.
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
 * ponytail: localStorage for now. F3b moves the refresh token to Keystore/StrongBox
 * behind a biometric prompt and calls `primeTokens()` from the native boot sequence
 * before React renders — which is why priming is a function and not an import side
 * effect. localStorage is defensible in the meantime because the WebView loads only
 * bundled assets, so there is no third-party script in the app to steal it, and it is
 * not defensible on the web, which is why the native gate below is unconditional.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const KEY = 'hm.tokens';

let tokens: Tokens | null = null;
let hydrated = false;

function isTokens(value: unknown): value is Tokens {
  const t = value as Partial<Tokens> | null | undefined;
  return typeof t?.accessToken === 'string' && typeof t?.refreshToken === 'string';
}

function hydrate(): void {
  if (hydrated || !isNativeShell()) return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    tokens = isTokens(parsed) ? parsed : null;
  } catch {
    tokens = null;
  }
}

/**
 * Seed the store from a secure source that could only be read asynchronously, before
 * the first render. F3b's Keystore read is the caller; nothing calls it today.
 */
export function primeTokens(next: Tokens | null): void {
  hydrated = true;
  tokens = next;
}

export function getAccessToken(): string | null {
  hydrate();
  return tokens?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  hydrate();
  return tokens?.refreshToken ?? null;
}

/**
 * Whether this client holds a credential of its own.
 *
 * This is what gates a refresh attempt on native, and it is deliberately NOT
 * "is there a cached profile in localStorage". Android clears WebView localStorage on
 * its own schedule — under storage pressure, or when the user clears app data partially
 * — while the token store (Keystore, after F3b) survives. Gating on the profile means a
 * user with a perfectly valid 30-day session gets silently signed out because a UX
 * cache was evicted.
 */
export function hasTokens(): boolean {
  hydrate();
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
  hydrated = true;
  tokens = next;
  try {
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode / quota — the in-memory copy still carries this session */
  }
}

export function clearTokens(): void {
  setTokens(null);
}
