import type { Request } from 'express';

import { getRequestContext } from './request-context';

const req = (over: Partial<Request> & { headers?: Record<string, unknown> } = {}): Request =>
  ({ headers: {}, socket: {}, ...over }) as unknown as Request;

/**
 * This feeds the audit trail, so the ordering matters: behind the compose reverse
 * proxy `request.ip` is the proxy, and the caller's real address only survives in
 * `x-forwarded-for`. Getting the precedence wrong makes every audit row identical.
 */
describe('getRequestContext', () => {
  it('prefers the first hop of x-forwarded-for over the socket address', () => {
    expect(
      getRequestContext(
        req({
          headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'curl/8' },
          ip: '10.0.0.1',
        }),
      ),
    ).toEqual({ ipAddress: '203.0.113.9', userAgent: 'curl/8' });
  });

  it('takes the first entry when the header arrives as an array', () => {
    expect(
      getRequestContext(req({ headers: { 'x-forwarded-for': ['198.51.100.7', '10.0.0.1'] } }))
        .ipAddress,
    ).toBe('198.51.100.7');
  });

  it('falls back to request.ip, then the socket, then null', () => {
    expect(getRequestContext(req({ ip: '10.0.0.4' })).ipAddress).toBe('10.0.0.4');
    expect(
      getRequestContext(req({ socket: { remoteAddress: '10.0.0.5' } as Request['socket'] }))
        .ipAddress,
    ).toBe('10.0.0.5');
    expect(getRequestContext(req()).ipAddress).toBeNull();
  });

  // An empty header is a proxy misconfiguration, not an address.
  it('ignores a blank x-forwarded-for and moves on', () => {
    expect(
      getRequestContext(req({ headers: { 'x-forwarded-for': '' }, ip: '10.0.0.6' })).ipAddress,
    ).toBe('10.0.0.6');
  });

  it('reports a missing user-agent as null rather than undefined', () => {
    expect(getRequestContext(req()).userAgent).toBeNull();
  });
});
