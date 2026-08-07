import type { Request } from 'express';

import { rateLimitKey } from '../../src/gateway.setup';

// J5: the bucket key decides WHO shares a rate-limit counter. rate-limit.e2e.spec.ts
// pins the wired behaviour through a real server; these pin the function's own edges,
// including the one a server can't produce — `req.ip` is always set once `trust proxy`
// is configured, so the fallback is only reachable if that configuration is ever lost.

const req = (parts: Partial<Request>) => ({ headers: {}, ...parts }) as Request;

describe('rateLimitKey', () => {
  it('prefers the Authorization header', () => {
    const key = rateLimitKey(req({ headers: { authorization: 'Bearer abc' }, ip: '10.0.0.1' }));
    expect(key.startsWith('t:')).toBe(true);
    expect(key).not.toContain('abc');
  });

  it('falls back to the session cookie, which is all a browser sends', () => {
    const key = rateLimitKey(req({ headers: { cookie: 'other=1; hm_at=abc' }, ip: '10.0.0.1' }));
    expect(key.startsWith('t:')).toBe(true);
    expect(key).not.toContain('abc');
  });

  it('gives the same caller the same bucket and different callers different ones', () => {
    const of = (token: string) => rateLimitKey(req({ headers: { authorization: token } }));
    expect(of('Bearer a')).toBe(of('Bearer a'));
    expect(of('Bearer a')).not.toBe(of('Bearer b'));
  });

  it('charges an anonymous caller to their address', () => {
    expect(rateLimitKey(req({ ip: '203.0.113.5' }))).toBe('i:203.0.113.5');
  });

  it('never returns an empty key when the address is missing', () => {
    // A key of `i:undefined` would silently collapse every such caller into ONE shared
    // counter — the per-deployment bucket B-2 exists to prevent.
    expect(rateLimitKey(req({}))).toBe('i:unknown');
  });
});
