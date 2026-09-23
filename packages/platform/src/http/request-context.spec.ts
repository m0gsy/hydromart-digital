import type { Request } from 'express';

import { getRequestContext, isTrustedProxyPeer } from './request-context';

const req = (over: Partial<Request> & { headers?: Record<string, unknown> } = {}): Request =>
  ({ headers: {}, socket: {}, ...over }) as unknown as Request;

/** A request that arrived through the compose reverse proxy, as every real one does. */
const viaProxy = (headers: Record<string, unknown>, peer = '10.0.0.1'): Request =>
  req({ headers, socket: { remoteAddress: peer } as Request['socket'] } as Partial<Request> & {
    headers: Record<string, unknown>;
  });

/**
 * This feeds the audit trail, the session record and the rate limiter, so where the address
 * comes from is a security decision, not a formatting one.
 *
 * CORE-3 / AUTH-4: `x-forwarded-for` used to win unconditionally — and it is a header, i.e.
 * whatever the sender typed. `curl -H 'X-Forwarded-For: 8.8.8.8'` wrote 8.8.8.8 into the
 * security trail, and a brute force rotating the header looked like a new person each try.
 */
describe('getRequestContext', () => {
  it('takes the first hop of x-forwarded-for when the peer is our own proxy', () => {
    expect(
      getRequestContext(
        viaProxy({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'curl/8' }),
      ),
    ).toEqual({ ipAddress: '203.0.113.9', userAgent: 'curl/8' });
  });

  it('takes the first entry when the header arrives as an array', () => {
    expect(
      getRequestContext(viaProxy({ 'x-forwarded-for': ['198.51.100.7', '10.0.0.1'] })).ipAddress,
    ).toBe('198.51.100.7');
  });

  /*
   * The one that matters: a request that reached the service directly from the internet.
   * Its peer is public, so nothing put that header there but the caller, and the socket
   * address is the only thing in the request they cannot choose.
   */
  it('ignores a forwarded-for claimed by an untrusted peer', () => {
    expect(
      getRequestContext(
        req({
          headers: { 'x-forwarded-for': '8.8.8.8' },
          socket: { remoteAddress: '203.0.113.50' } as Request['socket'],
        }),
      ).ipAddress,
    ).toBe('203.0.113.50');
  });

  it('falls back to the socket, then request.ip, then null', () => {
    expect(
      getRequestContext(req({ socket: { remoteAddress: '10.0.0.5' } as Request['socket'] }))
        .ipAddress,
    ).toBe('10.0.0.5');
    expect(getRequestContext(req({ ip: '10.0.0.4' })).ipAddress).toBe('10.0.0.4');
    expect(getRequestContext(req()).ipAddress).toBeNull();
  });

  // An empty header is a proxy misconfiguration, not an address.
  it('ignores a blank x-forwarded-for and moves on', () => {
    expect(getRequestContext(viaProxy({ 'x-forwarded-for': '' }, '10.0.0.6')).ipAddress).toBe(
      '10.0.0.6',
    );
  });

  it('reports a missing user-agent as null rather than undefined', () => {
    expect(getRequestContext(req()).userAgent).toBeNull();
  });
});

describe('isTrustedProxyPeer', () => {
  it.each(['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.16.0.9', '::1', 'fd00::1', '::ffff:10.1.2.3'])(
    'trusts the private peer %s',
    (address) => {
      expect(isTrustedProxyPeer(address)).toBe(true);
    },
  );

  it.each(['8.8.8.8', '203.0.113.50', '172.32.0.1', '2001:db8::1', undefined])(
    'does not trust %s',
    (address) => {
      expect(isTrustedProxyPeer(address)).toBe(false);
    },
  );
});
