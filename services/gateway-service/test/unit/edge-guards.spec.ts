import {
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
