import { json, Router } from 'express';
import type { Request, Response } from 'express';

// SEC-4: the gateway is the BFF that owns the browser session. Auth-service still
// mints bearer + refresh tokens in its JSON body; the gateway intercepts the three
// token-lifecycle endpoints, moves those tokens into httpOnly cookies the SPA's
// JavaScript can never read (XSS can't exfiltrate them), and returns only the public
// customer profile. Every other request is injected with `Authorization: Bearer`
// from the access cookie downstream (see gateway.setup.ts), so services are unchanged.

export const AT_COOKIE = 'hm_at';
export const RT_COOKIE = 'hm_rt';

/**
 * F2: a Capacitor WebView serves the app from `https://localhost` (Android) or
 * `capacitor://localhost` (iOS). Both are cross-site to the API host, so a
 * `sameSite: 'lax'` cookie is never sent from them — the cookie session simply does not
 * exist inside the app. The native shell carries a bearer token instead, which means
 * this router has to hand the tokens back in the response body for those origins rather
 * than swallowing them into cookies.
 *
 * The switch is `Origin` and deliberately nothing else. A client-settable flag
 * (`X-Client: native`) would be a hole big enough to lose the whole session model
 * through: `Origin` is a forbidden header name, so an XSS payload running on the web
 * origin cannot forge it, and therefore cannot ask this endpoint to hand it a 30-day
 * refresh token in readable JSON. Anything a page can set, a payload on that page can
 * set too.
 *
 * The web branch is untouched by all of this — same cookies, same body, same flow.
 */
export const NATIVE_ORIGINS = ['https://localhost', 'capacitor://localhost'] as const;
const NATIVE_ORIGIN_SET = new Set<string>(NATIVE_ORIGINS);

export function isNative(req: Request): boolean {
  return NATIVE_ORIGIN_SET.has(req.headers.origin ?? '');
}

/** The refresh token a native client sends explicitly, since it has no cookie to send. */
function bodyRefreshToken(body: unknown): string | undefined {
  const rt = (body as { refreshToken?: unknown } | undefined)?.refreshToken;
  return typeof rt === 'string' && rt.length > 0 ? rt : undefined;
}

/** The access token a native client sends as a bearer, where the browser sends a cookie. */
function bearerToken(req: Request): string | undefined {
  return /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
}

const AT_PATH = '/';
// Refresh token is only ever needed by refresh + logout, so scope its cookie to the
// auth path — it isn't attached to (and can't leak from) ordinary API calls.
const RT_PATH = '/auth/api/v1/auth';
const RT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30d — matches the refresh-token lifetime.

interface UpstreamSession {
  tokenType: string;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  customer: unknown;
}

/** Read one cookie from the raw header — avoids pulling cookie-parser into a pure proxy. */
export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function setSessionCookies(res: Response, s: UpstreamSession, secure: boolean): void {
  res.cookie(AT_COOKIE, s.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: AT_PATH,
    maxAge: s.expiresIn * 1000,
  });
  res.cookie(RT_COOKIE, s.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: RT_PATH,
    maxAge: RT_MAX_AGE_MS,
  });
}

function clearSessionCookies(res: Response, secure: boolean): void {
  res.clearCookie(AT_COOKIE, { path: AT_PATH, sameSite: 'lax', secure, httpOnly: true });
  res.clearCookie(RT_COOKIE, { path: RT_PATH, sameSite: 'lax', secure, httpOnly: true });
}

// Audit F-4: this router sits on the PUBLIC ingress and had neither a deadline nor a
// guarded parse. A hung auth-service held an express connection open indefinitely, and
// any non-JSON body (a proxy's HTML 502) threw a SyntaxError out of an async handler —
// which in Express 4 is an unhandled rejection, not a 500. Both are closed here.
const AUTH_TIMEOUT_MS = 10_000;

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function callAuth(
  authBase: string,
  path: string,
  // Every call site sends a body; `token` is what varies (logout carries one, verify does not).
  opts: { token?: string; body: unknown },
  timeoutMs: number,
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${authBase}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    });
    return { status: res.status, data: parseBody(await res.text()) };
  } finally {
    clearTimeout(timer);
  }
}

/** 503 body for a login/refresh that never reached auth-service — never a stack trace. */
const UPSTREAM_DOWN = { statusCode: 503, message: 'Layanan masuk sedang tidak tersedia.' };

const isSession = (status: number, data: unknown): data is UpstreamSession =>
  status >= 200 &&
  status < 300 &&
  typeof (data as { accessToken?: unknown } | undefined)?.accessToken === 'string';

/**
 * Router owning the browser's session lifecycle. Mounted at `/auth`; each route uses
 * its own json() so non-session `/auth/*` paths fall through to the proxy with their
 * request body untouched (buffering it here would break the proxied stream).
 */
export function createSessionRouter(
  authBase: string,
  secure: boolean,
  // Injectable so the abort path can be exercised with real timers — supertest's own
  // round-trip does not complete under jest's fake ones, and a ten-second wait in the
  // unit suite is not a test.
  timeoutMs: number = AUTH_TIMEOUT_MS,
): Router {
  const r = Router();

  // OTP verify — the only customer/staff login that yields tokens.
  r.post('/api/v1/auth/otp/verify', json(), async (req, res) => {
    let status: number;
    let data: unknown;
    try {
      ({ status, data } = await callAuth(
        authBase,
        '/api/v1/auth/otp/verify',
        { body: req.body },
        timeoutMs,
      ));
    } catch {
      return res.status(503).json(UPSTREAM_DOWN);
    }
    if (isSession(status, data)) {
      // Native gets the upstream body verbatim — tokens included — because it has no
      // cookie jar this gateway can write to.
      if (isNative(req)) return res.status(status).json(data);
      setSessionCookies(res, data, secure);
      return res.status(status).json({ customer: data.customer });
    }
    return res.status(status).json(data);
  });

  // Silent refresh — the SPA sends no body; the refresh token rides in the cookie.
  // The native shell has neither, so it sends the token it holds in the body.
  r.post('/api/v1/auth/token/refresh', json(), async (req, res) => {
    const native = isNative(req);
    const rt = native ? bodyRefreshToken(req.body) : readCookie(req, RT_COOKIE);
    if (!rt) return res.status(401).json({ statusCode: 401, message: 'No active session.' });
    let status: number;
    let data: unknown;
    try {
      ({ status, data } = await callAuth(
        authBase,
        '/api/v1/auth/token/refresh',
        { body: { refreshToken: rt } },
        timeoutMs,
      ));
    } catch {
      // Upstream unreachable is NOT an expired session — clearing the cookies here would
      // sign every user out on a blip they had nothing to do with.
      return res.status(503).json(UPSTREAM_DOWN);
    }
    if (isSession(status, data)) {
      if (native) return res.status(status).json(data);
      setSessionCookies(res, data, secure);
      return res.status(status).json({ customer: data.customer });
    }
    clearSessionCookies(res, secure);
    return res.status(401).json({ statusCode: 401, message: 'Session expired.' });
  });

  // Logout — revoke the refresh token upstream, then always clear cookies.
  //
  // The native branch is not cosmetic: read only from cookies and a native logout finds
  // no refresh token, skips the upstream revoke entirely, and leaves a token that stays
  // valid for its full 30 days on a phone the user believes they signed out of.
  r.post('/api/v1/auth/logout', json(), async (req, res) => {
    const native = isNative(req);
    const at = native ? bearerToken(req) : readCookie(req, AT_COOKIE);
    const rt = native ? bodyRefreshToken(req.body) : readCookie(req, RT_COOKIE);
    if (rt) {
      try {
        await callAuth(
          authBase,
          '/api/v1/auth/logout',
          { token: at, body: { refreshToken: rt } },
          timeoutMs,
        );
      } catch {
        /* best-effort revoke; cookies are cleared regardless so the client is signed out */
      }
    }
    clearSessionCookies(res, secure);
    return res.status(200).json({ message: 'Signed out.' });
  });

  return r;
}
