'use client';

import { askPlugin } from './capacitor';
import { endpoints } from './endpoints';
import { translate } from './locale-context';
import { isNativeShell } from './platform';
import { getSession, setSession } from './session-store';
import {
  captureTokens,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  hasTokens,
  tokensPersisted,
  unlockTokens,
} from './token-store';
import type { Session } from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

/**
 * Audit F-3: every request now carries a deadline. Without one a hung gateway
 * leaves the caller's spinner up forever — `fetch` has no default timeout and the
 * browser's own is minutes long. Uploads get a longer budget because a 5 MB photo
 * on a phone connection legitimately outlives a JSON round-trip.
 */
const TIMEOUT_MS = 15_000;
/** File transfers both ways: a 5 MB PoD photo up, a payroll PDF or XLSX report down. */
const FILE_TIMEOUT_MS = 60_000;

/** One automatic retry after a 429, capped so a long Retry-After never freezes the UI. */
const MAX_RETRY_AFTER_MS = 3_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * E6: the machine-readable code the services put beside the sentence
     * (`AllExceptionsFilter`). Carried so a screen can branch on WHICH refusal it got —
     * `/verify` closes its code box on `AUTH_OTP_MAX_ATTEMPTS`, `/login` walks an
     * unregistered number over to `/register` — without pattern-matching English prose.
     */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The machine code a service sent, if it sent one. */
function codeFrom(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'code' in body) {
    const c = (body as { code: unknown }).code;
    if (typeof c === 'string' && c) return c;
  }
  return undefined;
}

/**
 * E6: replace a named server error with its Indonesian wording.
 *
 * Six classes of auth failure reached the customer as the English sentence the service
 * threw — "No account is registered with this phone number.", `"abc" is not a valid
 * Indonesian mobile number.` — on a page rendered `lang="id"`. Translating by CODE
 * rather than by screen means every caller is fixed at once and none of them has to
 * know a code exists.
 *
 * Deliberately a whitelist: an unlisted code keeps the server's own message, because
 * several services already answer in Indonesian and blanket-overriding those would
 * replace a specific sentence with a vaguer one.
 */
function translatedByCode(body: unknown): string | undefined {
  const code = codeFrom(body);
  if (!code) return undefined;
  const key = `errors.byCode.${code}`;
  const translated = translate(key);
  return translated === key ? undefined : translated;
}

/** Flatten NestJS error bodies ({ message: string | string[] }) into one line. */
function messageFrom(status: number, body: unknown): string {
  const named = translatedByCode(body);
  if (named) return named;
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string') return m;
  }
  // These four are read by a person, on every screen, and they were English literals — so a
  // courier who lost signal got "Cannot reach the server" under `lang="id"`. This module is
  // not a component and cannot hold a hook; `translate` is the same resolver `useT` uses.
  if (status === 0) return translate('common.netUnreachable');
  if (status === 408) return translate('common.netTimeout');
  if (status === 429) return translate('common.netTooMany');
  return translate('common.netFailed', { status });
}

/**
 * Audit F-3: the old code ran `JSON.parse(text)` bare. Any non-JSON body — an HTML
 * 502 page from the proxy, a truncated response — threw a raw SyntaxError that no
 * caller catches, so the screen went blank instead of showing the error state.
 * A body we cannot parse is reported as what it is: the status, with no detail.
 */
function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Extra request headers — `Idempotency-Key` on the write paths that must not double. */
  headers?: Record<string, string>;
  /** internal: prevents an infinite refresh loop */
  _retry?: boolean;
  /** internal: prevents an infinite 429 retry loop */
  _rateRetry?: boolean;
}

/**
 * F2: the native shell has no cookie jar the gateway can reach, so it carries the access
 * token itself. Attached whenever one is held rather than only when `auth: true` — the
 * cookie it replaces was always sent too, and the gateway leaves an explicit
 * Authorization header intact (`gateway.setup.ts`), so the two transports behave alike.
 * On the web this is always empty and no request changes.
 */
function authHeader(): Record<string, string> {
  const at = getAccessToken();
  return at ? { Authorization: `Bearer ${at}` } : {};
}

/**
 * Whether this client holds a credential worth spending a refresh round-trip on.
 *
 * On the web that can only be inferred from the cached profile — the cookie is httpOnly
 * and unreadable. On native it must NOT be: Android evicts WebView localStorage on its
 * own schedule while the token store survives, so gating the refresh on the profile
 * would sign a user out of a session that was never in trouble.
 */
function hasCredential(): boolean {
  return isNativeShell() ? hasTokens() : getSession() !== null;
}

// Single-flight refresh: concurrent 401s share one refresh round-trip.
let refreshing: Promise<Session | null> | null = null;

async function refreshSession(): Promise<Session | null> {
  // On the web the refresh token rides in an httpOnly cookie the gateway reads — nothing
  // to send. Native holds its own and has to hand it over explicitly.
  if (!hasCredential()) return null;
  const body = isNativeShell() ? { refreshToken: getRefreshToken() } : undefined;
  if (!refreshing) {
    refreshing = rawRequest<Session>(endpoints.auth.refresh, { method: 'POST', body })
      .then((next) => {
        setSession(next);
        return next;
      })
      .catch((err: unknown) => {
        /*
         * Only a definite NO signs anybody out.
         *
         * This used to clear the session on ANY failure, and `rawRequest` throws for
         * three quite different things: 401 (the credential is dead), 408 (our own 15s
         * deadline elapsed) and 0 (the socket dropped). The last two mean "no answer",
         * not "no". Treating them as a refusal signed users out of healthy 30-day
         * sessions on a train, in a lift, or whenever the box was briefly busy — an
         * access token lasts 15 minutes, so this path runs constantly and only has to
         * be unlucky once.
         *
         * On anything short of a refusal the session STAYS. The request that triggered
         * this still fails with its own 401, and the next one refreshes again — which is
         * the correct outcome when the answer is simply unknown.
         */
        const refused = err instanceof ApiError && (err.status === 401 || err.status === 403);
        if (refused) {
          setSession(null);
          clearTokens();
        }
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/** `fetch` with a hard deadline. An abort surfaces as 408, a transport failure as 0. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // `controller.signal.aborted` distinguishes our deadline from a dropped socket;
    // the two need different messages because only one is worth retrying immediately.
    const status = controller.signal.aborted ? 408 : 0;
    void err;
    throw new ApiError(status, messageFrom(status, null));
  } finally {
    clearTimeout(timer);
  }
}

/** Retry-After is either delta-seconds or an HTTP date; both are honoured, capped. */
function retryAfterMs(res: Response): number {
  const raw = res.headers?.get?.('retry-after');
  if (!raw) return 500;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 500;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/**
 * E3: a path with an empty segment is a client bug, not a request.
 *
 * `useQueryParam('id')` answers `''` when the parameter is absent, and twenty-one detail
 * screens feed that straight into an endpoint builder — `endpoints.orders.get('')`
 * becomes `/orders/api/v1/orders/`. That reaches the server, which answers 404, and the
 * screen shows "not found" for a record nobody ever named. Refusing here, in the one
 * place all of them pass through, turns a misleading 404 into an honest instruction and
 * costs a round-trip that could never have succeeded.
 *
 * Only the PATH is inspected. `?depotId=` with no value is a filter meaning "any depot"
 * and several screens send it deliberately.
 */
function missingPathSegment(path: string): boolean {
  const pathname = path.split('?')[0] ?? '';
  return pathname.includes('//') || (pathname.length > 1 && pathname.endsWith('/'));
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (missingPathSegment(path)) {
    throw new ApiError(0, translate('errors.missingRouteId'), 'CLIENT_MISSING_ROUTE_ID');
  }
  const { method = 'GET', body } = options;
  const headers: Record<string, string> = { ...authHeader(), ...appHeaders(), ...options.headers };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetchWithTimeout(
    `${BASE_URL}${path}`,
    {
      method,
      headers,
      // SEC-4: the session cookie is httpOnly, so it only travels when the browser is
      // told to send credentials. No Authorization header — the gateway attaches the
      // bearer from the cookie downstream.
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    TIMEOUT_MS,
  );

  // Audit F-3: the gateway's rate limiter answers 429 with Retry-After. Nothing read
  // it, so a burst surfaced as "Request failed (429)" on a screen the user had done
  // nothing wrong on. One automatic wait-and-retry absorbs the common case.
  if (res.status === 429 && !options._rateRetry) {
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs(res)));
    return rawRequest<T>(path, { ...options, _rateRetry: true });
  }

  if (res.status === 204) return undefined as T;

  const data = parseBody(await res.text());

  if (!res.ok) throw new ApiError(res.status, messageFrom(res.status, data), codeFrom(data));
  // F2: the one door tokens enter this client through. On native the gateway returns the
  // session's tokens in the body (login-verify and refresh both), and they are taken out
  // here rather than at each call site, so a future token-bearing endpoint cannot be
  // added without the store already knowing about it. A no-op on the web, where the
  // gateway returns the customer alone and keeps the tokens in httpOnly cookies.
  // F3b: and wait for the Keystore before the caller can act on them. The rotated
  // refresh token is only useful once — if the process dies between the response and the
  // disk, the app relaunches holding the previous one, replays it, and the session
  // service's reuse detection revokes the whole family. A no-op on the web and on every
  // response that carries no tokens: `persisting` is an already-resolved promise.
  if (captureTokens(data)) await tokensPersisted();
  return data as T;
}

/** Authenticated request with transparent refresh-and-retry on 401. */
/*
 * N9: which binary is talking, and which build of it.
 *
 * The app does not wrap a moving web app — `cap sync` copies a FROZEN export into the
 * APK, so a phone keeps whatever UI it was installed with until somebody updates it. The
 * real risk is therefore API skew against binaries in the field, and nothing anywhere
 * recorded which versions those are: the compatibility floor was a guess, and dropping an
 * endpoint was a guess about a guess.
 *
 * Two headers, filled once per process from the App plugin and empty on the web. Cheap
 * enough to send on every request, and the gateway turns them into one bounded counter.
 */
let appTag: Record<string, string> | null = null;

export function primeAppHeaders(info: { id?: string; build?: string } | null): void {
  appTag = info?.id && info?.build ? { 'X-App-Id': info.id, 'X-App-Version': info.build } : {};
}

function appHeaders(): Record<string, string> {
  if (appTag === null) {
    // Kick the async read off once; until it lands, requests simply go out untagged. A
    // header that identifies the build must never delay the request that carries it.
    appTag = {};
    void askPlugin<{ id?: string; build?: string }>('App', 'getInfo').then(primeAppHeaders);
  }
  return appTag;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // F3b: nothing that needs a bearer may go out before the Keystore has been read.
  //
  // Reading it is asynchronous and can sit behind a biometric prompt for several
  // seconds, while React mounts the landing screen immediately — and the courier's
  // `/driver` home fires four authenticated requests the moment it renders. Without this
  // line every one of them leaves with no token, 401s, finds no credential to refresh
  // with, and the app opens onto four error states for a session that was never in
  // trouble. `RequireAuth` covers the pages that use it; this covers the ones that do
  // not, in the one place they all pass through.
  //
  // Resolved-promise no-op on the web and on every request after the first.
  if (options.auth) await unlockTokens();
  try {
    return await rawRequest<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && options.auth && !options._retry) {
      const next = await refreshSession();
      if (next) return rawRequest<T>(path, { ...options, _retry: true });
    }
    throw err;
  }
}

/**
 * Audit F-1/F-2: identical GETs fired in the same tick used to be N round-trips.
 * One favourites list per grid card, one categories call per component that renders
 * a chip row — every one of them a separate request against a rate limit measured
 * per minute. Sharing the in-flight promise makes concurrent callers cost one.
 *
 * Only in-flight requests are shared, and only for GET. A settled result is dropped
 * immediately, so a reload button or a read after a mutation still hits the server —
 * data staleness is never traded for the saving. Reference data that genuinely does
 * not change mid-session opts into a real TTL via `getCached`.
 */
const inflight = new Map<string, Promise<unknown>>();
const cached = new Map<string, { at: number; value: unknown }>();

const keyOf = (path: string, auth: boolean) => `${auth ? 'a' : 'p'}:${path}`;

function sharedGet<T>(path: string, auth: boolean, ttlMs: number): Promise<T> {
  const key = keyOf(path, auth);

  if (ttlMs > 0) {
    const hit = cached.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T);
  }

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = request<T>(path, { auth })
    .then((value) => {
      // Failures are never cached: an error must be reproducible on the next attempt.
      if (ttlMs > 0) cached.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}

/** Drop every cached read. Called after any mutation — see `api.post`/`put`/`patch`/`del`. */
function invalidate(): void {
  cached.clear();
}

/**
 * Multipart upload (always authenticated). The JSON `api` helpers force a JSON
 * Content-Type, so file uploads need this path: it lets the browser set the
 * multipart boundary and attaches the bearer token.
 *
 * The 401 refresh-retry used to be skipped here, on the reasoning that the caller
 * had just loaded its data with `api` so the token was fresh. That assumption does
 * not hold for `offline-queue.ts`, which flushes a proof-of-delivery photo captured
 * hours earlier the moment signal returns — with no read in front of it. Without the
 * retry EVERY queued PoD upload fails 401 and the courier's proof is lost.
 */
export async function uploadFile<T = { url: string }>(
  path: string,
  file: File | Blob,
  /** Extra form fields sent alongside the file (e.g. which employee a document belongs to). */
  fields: Record<string, string> = {},
  /** internal: prevents an infinite refresh loop */
  _retry = false,
): Promise<T> {
  // Same wait as `request()`: the offline queue flushes proof-of-delivery photos on the
  // first signal after a cold start, which can be before the Keystore has been read.
  await unlockTokens();

  if (missingPathSegment(path)) {
    throw new ApiError(0, translate('errors.missingRouteId'), 'CLIENT_MISSING_ROUTE_ID');
  }

  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);

  const res = await fetchWithTimeout(
    `${BASE_URL}${path}`,
    {
      method: 'POST',
      // SEC-4: httpOnly session cookie carries auth; let the browser set the multipart
      // boundary. Do NOT set Content-Type here — `authHeader()` is bearer-only for the
      // native shell, which has no cookie.
      credentials: 'include',
      headers: authHeader(),
      body: form,
    },
    FILE_TIMEOUT_MS,
  );

  // Recursing rebuilds the FormData from the original arguments, so the retry never
  // re-sends a body the first attempt already consumed.
  if (res.status === 401 && !_retry && (await refreshSession())) {
    return uploadFile<T>(path, file, fields, true);
  }

  const data = parseBody(await res.text());
  if (!res.ok) throw new ApiError(res.status, messageFrom(res.status, data), codeFrom(data));
  invalidate();
  return data as T;
}

/**
 * Authenticated GET whose body is a file, not JSON — payroll slip PDFs and the HR
 * report exports (CSV/XLSX/PDF). Those two screens used to call `fetch` directly and
 * so inherited none of this module's guarantees: no deadline, no 401 refresh-retry,
 * and — once the native shell sends a bearer instead of a cookie — no auth at all.
 */
export async function getBlob(path: string, _retry = false): Promise<Blob> {
  if (missingPathSegment(path)) {
    throw new ApiError(0, translate('errors.missingRouteId'), 'CLIENT_MISSING_ROUTE_ID');
  }
  const res = await fetchWithTimeout(
    `${BASE_URL}${path}`,
    { method: 'GET', credentials: 'include', headers: authHeader() },
    FILE_TIMEOUT_MS,
  );

  if (res.status === 401 && !_retry && (await refreshSession())) {
    return getBlob(path, true);
  }

  if (!res.ok) {
    const data = parseBody(await res.text());
    throw new ApiError(res.status, messageFrom(res.status, data), codeFrom(data));
  }
  return res.blob();
}

// DELETE overload: most callers take no body (`api.del(path, true)`); the settings
// reset endpoint needs a JSON body too — kept backward-compatible by branching on
// whether the second arg is a boolean (auth-only) or the body itself.
function del<T>(path: string, auth?: boolean): Promise<T>;
function del<T>(path: string, body: unknown, auth?: boolean): Promise<T>;
function del<T>(path: string, bodyOrAuth?: unknown, auth = false): Promise<T> {
  invalidate();
  if (typeof bodyOrAuth === 'boolean' || bodyOrAuth === undefined) {
    return request<T>(path, { method: 'DELETE', auth: bodyOrAuth ?? false });
  }
  return request<T>(path, { method: 'DELETE', body: bodyOrAuth, auth });
}

function mutate<T>(method: string) {
  // `headers` is how a checkout carries its Idempotency-Key (B-13) — the same key across
  // every retry of one attempt, so it has to survive this wrapper.
  return (
    path: string,
    body?: unknown,
    auth = false,
    headers?: Record<string, string>,
  ): Promise<T> => {
    invalidate();
    return request<T>(path, { method, body, auth, headers });
  };
}

export const api = {
  get: <T>(path: string, auth = false) => sharedGet<T>(path, auth, 0),
  /**
   * GET whose answer is reference data — categories, capability matrices, settings.
   * Re-reading it on every screen that renders a chip row is the fan-out F-2 named.
   * Any mutation clears it, so a stale read can only outlive a change made elsewhere.
   */
  getCached: <T>(path: string, auth = false, ttlMs = 60_000) => sharedGet<T>(path, auth, ttlMs),
  post: <T>(path: string, body?: unknown, auth = false, headers?: Record<string, string>) =>
    mutate<T>('POST')(path, body, auth, headers),
  put: <T>(path: string, body?: unknown, auth = false) => mutate<T>('PUT')(path, body, auth),
  patch: <T>(path: string, body?: unknown, auth = false) => mutate<T>('PATCH')(path, body, auth),
  del,
  invalidate,
};
