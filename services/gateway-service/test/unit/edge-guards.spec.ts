import { atCookieName, rtCookieName } from '../../src/routing/session-bff';
import {
  cookiesAreSecure,
  insecureTransportWarning,
  isOtpIssuingPath,
  isPrivatePeer,
  metricsForPrivateNetworkOnly,
} from '../../src/gateway.setup';

/*
 * GW-1. Express routes case-insensitively and ignores a trailing slash; the OTP tier did
 * neither, so a changed case or an extra slash reached the paid-SMS handler past the tier.
 */
describe('isOtpIssuingPath', () => {
  it.each([
    '/auth/api/v1/auth/register',
    '/auth/api/v1/auth/register/',
    '/auth/api/v1/auth/REGISTER',
    '/auth/api/v1/auth/Login//',
    '/auth/api/v2/auth/otp/resend',
    '/auth//api/v1/auth/otp/resend',
  ])('counts %s', (path) => {
    expect(isOtpIssuingPath(path)).toBe(true);
  });

  it.each(['/auth/api/v1/auth/otp/verify', '/auth/api/v1/auth/me', '/orders/api/v1/register'])(
    'does not count %s',
    (path) => {
      expect(isOtpIssuingPath(path)).toBe(false);
    },
  );
});

/* GW-3. Prometheus scrapes over the docker network; nobody else reads /metrics. */
describe('metrics from the private network only', () => {
  it.each([
    '10.0.0.5',
    '172.18.0.3',
    '192.168.1.9',
    '127.0.0.1',
    '::1',
    '::ffff:172.20.0.2',
    'fd00::1',
  ])('lets %s through', (address) => {
    expect(isPrivatePeer(address)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '::ffff:1.2.3.4', '2001:db8::1', undefined])(
    'refuses %s',
    (address) => {
      expect(isPrivatePeer(address)).toBe(false);
    },
  );

  it('404s a public peer and passes a private one', () => {
    const next = jest.fn();
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };
    metricsForPrivateNetworkOnly(
      { socket: { remoteAddress: '203.0.113.7' } } as never,
      res as never,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();

    metricsForPrivateNetworkOnly(
      { socket: { remoteAddress: '172.18.0.9' } } as never,
      res as never,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('insecureTransportWarning', () => {
  it('speaks only for production with no WEB_DOMAIN', () => {
    expect(insecureTransportWarning('production', '')).toMatch(/no TLS/);
    expect(insecureTransportWarning('production', undefined)).toMatch(/no TLS/);
    expect(insecureTransportWarning('production', 'hydromart-digital.com')).toBeNull();
    expect(insecureTransportWarning('development', '')).toBeNull();
  });
});

/*
 * GW-4 (owner decision 2026-09-17). `readCookie` takes the first cookie of a name, and a
 * cookie set at a more specific Path is sent first — so anything that could write a cookie
 * on this host could shadow the session. The prefixes are what the browser enforces:
 * `__Host-` (no Domain, Path=/, Secure) for the access cookie, `__Secure-` for the refresh
 * cookie, which keeps its narrower path and so cannot take `__Host-`.
 */
describe('session cookie names', () => {
  it('prefixes both cookies once the transport is secure', () => {
    expect(atCookieName(true)).toBe('__Host-hm_at');
    expect(rtCookieName(true)).toBe('__Secure-hm_rt');
  });

  it('keeps the plain names where there is no TLS to make a prefix mean anything', () => {
    expect(atCookieName(false)).toBe('hm_at');
    expect(rtCookieName(false)).toBe('hm_rt');
  });
});

/*
 * GW-4: Secure cookies (and so the prefixes) follow TLS, not NODE_ENV. The integration
 * stack runs NODE_ENV=production over plain HTTP — Secure cookies there are cookies no
 * browser keeps, which is exactly how that stack lost its session.
 */
describe('cookiesAreSecure', () => {
  it('is true only when production also has a domain in front of it', () => {
    expect(cookiesAreSecure('production', 'hydromart-digital.com')).toBe(true);
    expect(cookiesAreSecure('production', '')).toBe(false);
    expect(cookiesAreSecure('production', undefined)).toBe(false);
    expect(cookiesAreSecure('development', 'hydromart-digital.com')).toBe(false);
  });
});
