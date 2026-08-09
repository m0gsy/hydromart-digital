import express, { type Express } from 'express';
import request from 'supertest';

import {
  AT_COOKIE,
  RT_COOKIE,
  createSessionRouter,
  isNative,
  readCookie,
} from '../../src/routing/session-bff';

const AUTH_BASE = 'http://auth.test';

type FetchResult = { status: number; text: () => Promise<string> };
const fetchMock = jest.fn<Promise<FetchResult>, [string, unknown]>();

function jsonRes(status: number, body?: unknown): FetchResult {
  return { status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}

function makeApp(secure = false): Express {
  const app = express();
  app.use('/auth', createSessionRouter(AUTH_BASE, secure));
  return app;
}

const SESSION = {
  tokenType: 'Bearer',
  accessToken: 'AT-123',
  expiresIn: 900,
  refreshToken: 'RT-456',
  customer: { id: 7, name: 'Budi' },
};

beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

describe('readCookie', () => {
  const req = (cookie?: string) => ({ headers: cookie === undefined ? {} : { cookie } }) as never;

  it('returns undefined when no cookie header is present', () => {
    expect(readCookie(req(), 'hm_at')).toBeUndefined();
  });

  it('reads and url-decodes the named cookie', () => {
    expect(readCookie(req('hm_at=a%20b; hm_rt=RT'), 'hm_at')).toBe('a b');
  });

  it('skips malformed segments without an equals sign', () => {
    expect(readCookie(req('flagonly; hm_at=AT'), 'hm_at')).toBe('AT');
  });

  it('returns undefined when the named cookie is absent', () => {
    expect(readCookie(req('other=1'), 'hm_at')).toBeUndefined();
  });
});

describe('isNative', () => {
  const req = (origin?: string) => ({ headers: origin === undefined ? {} : { origin } }) as never;

  it('recognises the two Capacitor origins', () => {
    expect(isNative(req('https://localhost'))).toBe(true);
    expect(isNative(req('capacitor://localhost'))).toBe(true);
  });

  it('is false for a browser origin and for no origin at all', () => {
    expect(isNative(req('https://app.hydromart.id'))).toBe(false);
    expect(isNative(req())).toBe(false);
  });

  // The whole reason the switch is Origin and not a header the page can set: a lookalike
  // must not be enough to talk this router out of its cookies.
  it('is false for origins that merely look like the native one', () => {
    expect(isNative(req('http://localhost'))).toBe(false);
    expect(isNative(req('https://localhost:3000'))).toBe(false);
    expect(isNative(req('https://localhost.evil.id'))).toBe(false);
  });
});

describe('createSessionRouter — native (Capacitor origin)', () => {
  const NATIVE = 'https://localhost';

  it('returns the tokens in the body and sets NO cookies on verify', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, SESSION));
    const res = await request(makeApp())
      .post('/auth/api/v1/auth/otp/verify')
      .set('Origin', NATIVE)
      .send({ otp: '000000' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(SESSION);
    // A cookie here would be dead weight: `sameSite: 'lax'` means the WebView never
    // sends it back, so the session would silently be one request long.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refreshes from the request body, since there is no cookie to read', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, SESSION));
    const res = await request(makeApp())
      .post('/auth/api/v1/auth/token/refresh')
      .set('Origin', NATIVE)
      .send({ refreshToken: 'RT-456' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(SESSION);
    expect(res.headers['set-cookie']).toBeUndefined();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as { body: string }).body)).toEqual({ refreshToken: 'RT-456' });
  });

  it('401s a native refresh with no token in the body, and never calls upstream', async () => {
    const res = await request(makeApp())
      .post('/auth/api/v1/auth/token/refresh')
      .set('Origin', NATIVE)
      .send({});

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a cookie sent from a native origin — the body is the only source', async () => {
    const res = await request(makeApp())
      .post('/auth/api/v1/auth/token/refresh')
      .set('Origin', NATIVE)
      .set('Cookie', `${RT_COOKIE}=RT-456`)
      .send({});

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-string refreshToken rather than forwarding it', async () => {
    const res = await request(makeApp())
      .post('/auth/api/v1/auth/token/refresh')
      .set('Origin', NATIVE)
      .send({ refreshToken: { evil: true } });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Without this the native logout finds no cookie, skips the revoke, and leaves a token
  // alive for its full 30 days on a phone the user believes they signed out of.
  it('revokes upstream on logout using the body token and the bearer', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { ok: true }));
    const res = await request(makeApp())
      .post('/auth/api/v1/auth/logout')
      .set('Origin', NATIVE)
      .set('Authorization', 'Bearer AT-123')
      .send({ refreshToken: 'RT-456' });

    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${AUTH_BASE}/api/v1/auth/logout`);
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe(
      'Bearer AT-123',
    );
    expect(JSON.parse((init as { body: string }).body)).toEqual({ refreshToken: 'RT-456' });
  });

  // An access token that has already expired is the normal case for a logout, so the
  // revoke must not depend on one being there.
  it.each([
    ['malformed', 'Basic nonsense'],
    ['absent', undefined],
  ])('still revokes when the bearer header is %s', async (_label, header) => {
    fetchMock.mockResolvedValue(jsonRes(200, { ok: true }));
    let req = request(makeApp()).post('/auth/api/v1/auth/logout').set('Origin', NATIVE);
    if (header) req = req.set('Authorization', header);
    const res = await req.send({ refreshToken: 'RT-456' });

    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as { headers: Record<string, string> }).headers.authorization).toBeUndefined();
  });

  it('passes an upstream rejection through unchanged on native verify', async () => {
    fetchMock.mockResolvedValue(jsonRes(400, { message: 'bad otp' }));
    const res = await request(makeApp())
      .post('/auth/api/v1/auth/otp/verify')
      .set('Origin', NATIVE)
      .send({ otp: 'x' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'bad otp' });
  });

  it('401s a native refresh the upstream rejected', async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { message: 'expired' }));
    const res = await request(makeApp())
      .post('/auth/api/v1/auth/token/refresh')
      .set('Origin', NATIVE)
      .send({ refreshToken: 'RT-DEAD' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ statusCode: 401, message: 'Session expired.' });
  });
});

describe('createSessionRouter — otp/verify', () => {
  const verify = (app: Express, body: object) =>
    request(app).post('/auth/api/v1/auth/otp/verify').send(body);

  it('on session response sets both cookies and returns only the customer', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, SESSION));
    const res = await verify(makeApp(), { otp: '000000' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ customer: SESSION.customer });
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookies).toContain(`${AT_COOKIE}=AT-123`);
    expect(cookies).toContain(`${RT_COOKIE}=RT-456`);
    // forwarded to the real auth endpoint with the request body
    expect(fetchMock).toHaveBeenCalledWith(
      `${AUTH_BASE}/api/v1/auth/otp/verify`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('passes a non-session error response straight through with no cookies', async () => {
    fetchMock.mockResolvedValue(jsonRes(400, { message: 'bad otp' }));
    const res = await verify(makeApp(), { otp: 'x' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'bad otp' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('handles an empty upstream body (undefined data path)', async () => {
    fetchMock.mockResolvedValue(jsonRes(204));
    const res = await verify(makeApp(), {});
    expect(res.status).toBe(204);
  });

  // Audit F-4: this router is on the PUBLIC ingress. Before the fix a proxy's HTML
  // error page threw a SyntaxError out of the async handler and a hung auth-service
  // held the connection open with no deadline.
  it('a non-JSON upstream body is passed through as a status, not a SyntaxError', async () => {
    fetchMock.mockResolvedValue({ status: 502, text: async () => '<html>502</html>' });
    const res = await verify(makeApp(), { otp: '000000' });
    expect(res.status).toBe(502);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('an unreachable auth-service answers 503 instead of crashing the handler', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await verify(makeApp(), { otp: '000000' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ statusCode: 503, message: 'Layanan masuk sedang tidak tersedia.' });
  });

  it('sends an abort signal so a hung auth-service cannot hold the request open', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, SESSION));
    await verify(makeApp(), { otp: '000000' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  // The signal is only half the fix — something has to FIRE it. Without the timer the
  // deadline is a decoration and an auth-service that never answers still holds the
  // connection open. Real timers with an injected 20ms budget: supertest's own round-trip
  // does not complete under jest's fake ones.
  it('aborts the upstream call once the deadline passes, and answers 503', async () => {
    let aborted = false;
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const { signal } = init as { signal: AbortSignal };
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    );

    const app = express();
    app.use('/auth', createSessionRouter(AUTH_BASE, false, 20));
    const res = await request(app).post('/auth/api/v1/auth/otp/verify').send({ otp: '000000' });

    expect(aborted).toBe(true);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ statusCode: 503, message: 'Layanan masuk sedang tidak tersedia.' });
  });
});

describe('createSessionRouter — token/refresh', () => {
  const refresh = (app: Express, cookie?: string) => {
    const r = request(app).post('/auth/api/v1/auth/token/refresh');
    return cookie ? r.set('Cookie', cookie) : r;
  };

  it('returns 401 when no refresh cookie is present', async () => {
    const res = await refresh(makeApp());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ statusCode: 401, message: 'No active session.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-issues cookies on a valid refresh', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, SESSION));
    const res = await refresh(makeApp(), `${RT_COOKIE}=RT-456`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ customer: SESSION.customer });
    expect(fetchMock).toHaveBeenCalledWith(
      `${AUTH_BASE}/api/v1/auth/token/refresh`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // A transport failure is NOT an expired session: clearing the cookies here would sign
  // every user out on a blip they had nothing to do with.
  it('returns 503 and KEEPS the cookies when auth-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await refresh(makeApp(), `${RT_COOKIE}=RT-456`);

    expect(res.status).toBe(503);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('clears cookies and returns 401 when the refresh is rejected upstream', async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { message: 'expired' }));
    const res = await refresh(makeApp(), `${RT_COOKIE}=RT-456`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ statusCode: 401, message: 'Session expired.' });
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookies).toContain(`${AT_COOKIE}=;`);
    expect(cookies).toContain(`${RT_COOKIE}=;`);
  });
});

describe('createSessionRouter — logout', () => {
  const logout = (app: Express, cookie?: string) => {
    const r = request(app).post('/auth/api/v1/auth/logout');
    return cookie ? r.set('Cookie', cookie) : r;
  };

  it('revokes upstream then clears cookies when a refresh token is present', async () => {
    fetchMock.mockResolvedValue(jsonRes(200, { ok: true }));
    const res = await logout(makeApp(), `${AT_COOKIE}=AT-123; ${RT_COOKIE}=RT-456`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Signed out.' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${AUTH_BASE}/api/v1/auth/logout`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('still clears cookies (200) when the upstream revoke throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const res = await logout(makeApp(), `${RT_COOKIE}=RT-456`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Signed out.' });
  });

  it('skips the upstream call when there is no refresh token', async () => {
    const res = await logout(makeApp());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Signed out.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
