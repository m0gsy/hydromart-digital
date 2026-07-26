import express, { type Express } from 'express';
import request from 'supertest';

import {
  AT_COOKIE,
  RT_COOKIE,
  createSessionRouter,
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
