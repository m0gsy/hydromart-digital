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

async function callAuth(
  authBase: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${authBase}${path}`, {
    method: 'POST',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : undefined };
}

const isSession = (status: number, data: any): data is UpstreamSession =>
  status >= 200 && status < 300 && typeof data?.accessToken === 'string';

/**
 * Router owning the browser's session lifecycle. Mounted at `/auth`; each route uses
 * its own json() so non-session `/auth/*` paths fall through to the proxy with their
 * request body untouched (buffering it here would break the proxied stream).
 */
export function createSessionRouter(authBase: string, secure: boolean): Router {
  const r = Router();

  // OTP verify — the only customer/staff login that yields tokens.
  r.post('/api/v1/auth/otp/verify', json(), async (req, res) => {
    const { status, data } = await callAuth(authBase, '/api/v1/auth/otp/verify', { body: req.body });
    if (isSession(status, data)) {
      setSessionCookies(res, data, secure);
      return res.status(status).json({ customer: data.customer });
    }
    return res.status(status).json(data);
  });

  // Silent refresh — the SPA sends no body; the refresh token rides in the cookie.
  r.post('/api/v1/auth/token/refresh', json(), async (req, res) => {
    const rt = readCookie(req, RT_COOKIE);
    if (!rt) return res.status(401).json({ statusCode: 401, message: 'No active session.' });
    const { status, data } = await callAuth(authBase, '/api/v1/auth/token/refresh', {
      body: { refreshToken: rt },
    });
    if (isSession(status, data)) {
      setSessionCookies(res, data, secure);
      return res.status(status).json({ customer: data.customer });
    }
    clearSessionCookies(res, secure);
    return res.status(401).json({ statusCode: 401, message: 'Session expired.' });
  });

  // Logout — revoke the refresh token upstream, then always clear cookies.
  r.post('/api/v1/auth/logout', json(), async (req, res) => {
    const at = readCookie(req, AT_COOKIE);
    const rt = readCookie(req, RT_COOKIE);
    if (rt) {
      try {
        await callAuth(authBase, '/api/v1/auth/logout', { token: at, body: { refreshToken: rt } });
      } catch {
        /* best-effort revoke; cookies are cleared regardless so the client is signed out */
      }
    }
    clearSessionCookies(res, secure);
    return res.status(200).json({ message: 'Signed out.' });
  });

  return r;
}
