import { trustProxyHops } from '../../src/gateway.setup';

/*
 * The rate limit keys on `req.ip`, and `req.ip` is whatever the trust-proxy setting says to
 * believe. Getting this pair wrong does not fail loudly — it serves an edge with no limit
 * at all while every dashboard still looks green. So the pair is asserted, not commented.
 */
describe('trustProxyHops', () => {
  it('trusts Caddy when the port is loopback-only', () => {
    expect(trustProxyHops('production', '127.0.0.1', 'hydromart-digital.com')).toBe(1);
    expect(trustProxyHops('production', '', 'hydromart-digital.com')).toBe(1);
    expect(trustProxyHops('production', '::1', 'hydromart-digital.com')).toBe(1);
    expect(trustProxyHops('production', 'localhost', 'hydromart-digital.com')).toBe(1);
  });

  /*
   * The documented bare-IP deploy: no Caddy, so PUBLIC_BIND=0.0.0.0 is correct and
   * required. What was wrong there was trusting a hop nobody adds — every client could
   * name its own IP and get its own counter.
   */
  it('trusts nothing when no proxy is configured, whatever the bind', () => {
    expect(trustProxyHops('production', '0.0.0.0', '')).toBe(0);
    expect(trustProxyHops('production', '0.0.0.0', undefined)).toBe(0);
    expect(trustProxyHops('production', '127.0.0.1', '')).toBe(0);
  });

  it('refuses to boot when both paths in are open at once', () => {
    expect(() => trustProxyHops('production', '0.0.0.0', 'hydromart-digital.com')).toThrow(
      /PUBLIC_BIND=0\.0\.0\.0/,
    );
    expect(() => trustProxyHops('production', '10.0.0.5', 'hydromart-digital.com')).toThrow(
      /rate limit stops existing/,
    );
  });

  /* A developer running the compose stack locally is not the situation being protected. */
  it('does not refuse outside production', () => {
    expect(trustProxyHops('development', '0.0.0.0', 'localhost')).toBe(1);
  });
});
