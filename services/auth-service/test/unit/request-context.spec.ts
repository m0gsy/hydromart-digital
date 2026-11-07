import type { Request } from 'express';

import { getRequestContext } from '../../src/common/http/request-context';

const req = (peer: string, headers: Record<string, string>): Request =>
  ({ headers, socket: { remoteAddress: peer }, ip: peer }) as unknown as Request;

// AUT-03: this module used to be its own copy that took x-forwarded-for from ANY peer, so
// `curl -H 'X-Forwarded-For: 8.8.8.8'` wrote an address of the caller's choosing into the
// login audit trail and the session record.
describe('getRequestContext (auth-service)', () => {
  it('ignores x-forwarded-for from a public peer', () => {
    const ctx = getRequestContext(req('203.0.113.9', { 'x-forwarded-for': '8.8.8.8' }));
    expect(ctx.ipAddress).toBe('203.0.113.9');
  });

  it('trusts x-forwarded-for from the private proxy in front of the service', () => {
    const ctx = getRequestContext(
      req('10.0.0.5', { 'x-forwarded-for': '198.51.100.7', 'user-agent': 'jest' }),
    );
    expect(ctx).toEqual({ ipAddress: '198.51.100.7', userAgent: 'jest' });
  });
});
