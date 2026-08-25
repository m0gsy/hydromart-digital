import { createHmac } from 'node:crypto';

import type { Request } from 'express';

import { rateLimitKey } from '../../src/gateway.setup';

/*
 * L3-SEC-1. The bucket key decides WHO shares a rate-limit counter, and before this it was
 * decided by the caller: any byte string in an Authorization header minted a private bucket,
 * so an address that had spent its IP budget got a fresh one per invented token. Measured
 * against the running gateway: 0 of 60 requests passed with no header, 28 of 60 passed with a
 * junk bearer rotated per request, from the same address.
 *
 * The tests below used to assert the broken half deliberately — `of('Bearer a')` and
 * `of('Bearer b')` were expected to differ, which is exactly the bypass. They now assert the
 * opposite for unverifiable input, and the identity cases use real signed tokens.
 */

const SECRET = 'unit-test-access-secret-long-enough-0123456789';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** A token this deployment really did sign. `alg` is what the verifier insists on. */
function sign(payload: Record<string, unknown>, secret = SECRET, alg = 'HS256'): string {
  const head = b64({ alg, typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const req = (parts: Partial<Request>) => ({ headers: {}, ...parts }) as Request;
const keyOf = (parts: Partial<Request>) => rateLimitKey(req(parts), SECRET);

const future = Math.floor(Date.now() / 1000) + 3600;

describe('rateLimitKey · an identity the gateway can prove', () => {
  it('charges a verified caller to their `sub`, on the header transport', () => {
    const at = sign({ sub: 'cust-1', exp: future });
    expect(keyOf({ headers: { authorization: `Bearer ${at}` }, ip: '10.0.0.1' })).toBe('u:cust-1');
  });

  it('reads the session cookie too, which is all a browser sends', () => {
    const at = sign({ sub: 'staff-9', exp: future });
    expect(keyOf({ headers: { cookie: `other=1; hm_at=${at}` }, ip: '10.0.0.1' })).toBe('u:staff-9');
  });

  it('gives two verified callers behind one address their own budgets', () => {
    const a = sign({ sub: 'courier-a', exp: future });
    const b = sign({ sub: 'courier-b', exp: future });
    const at = (t: string) => keyOf({ headers: { authorization: `Bearer ${t}` }, ip: '192.0.2.50' });
    expect(at(a)).not.toBe(at(b));
  });

  it('keeps one person on ONE bucket across a refresh', () => {
    // The old key was the token bytes, so a rotation every ~15 minutes handed out a fresh
    // budget. Two different valid tokens for the same subject are the same caller.
    const first = sign({ sub: 'cust-1', exp: future, jti: 'a' });
    const second = sign({ sub: 'cust-1', exp: future, jti: 'b' });
    expect(first).not.toBe(second);
    const at = (t: string) => keyOf({ headers: { authorization: `Bearer ${t}` } });
    expect(at(first)).toBe(at(second));
  });
});

describe('rateLimitKey · anything it cannot verify is anonymous', () => {
  const ip = '203.0.113.5';
  const at = (token: string) => keyOf({ headers: { authorization: `Bearer ${token}` }, ip });

  it('refuses a bearer nobody issued — the reported bypass', () => {
    expect(at('junk')).toBe(`i:${ip}`);
    // The shape that actually got through: a different value every request.
    expect(at('junk-1')).toBe(at('junk-2'));
  });

  it('refuses a token signed with the wrong secret', () => {
    expect(at(sign({ sub: 'cust-1', exp: future }, 'not-the-secret'))).toBe(`i:${ip}`);
  });

  it('refuses a tampered payload under a real signature', () => {
    const [head, , sig] = sign({ sub: 'cust-1', exp: future }).split('.');
    expect(at(`${head}.${b64({ sub: 'admin', exp: future })}.${sig}`)).toBe(`i:${ip}`);
  });

  it('refuses `alg: none`, however well-formed the rest is', () => {
    const head = b64({ alg: 'none', typ: 'JWT' });
    const body = b64({ sub: 'cust-1', exp: future });
    expect(at(`${head}.${body}.`)).toBe(`i:${ip}`);
  });

  it('refuses an asymmetric `alg` rather than checking a public key as a secret', () => {
    expect(at(sign({ sub: 'cust-1', exp: future }, SECRET, 'RS256'))).toBe(`i:${ip}`);
  });

  it('refuses an expired token, so one harvested token cannot mint a bucket forever', () => {
    expect(at(sign({ sub: 'cust-1', exp: Math.floor(Date.now() / 1000) - 1 }))).toBe(`i:${ip}`);
  });

  it('refuses a verified token with no subject to charge', () => {
    expect(at(sign({ exp: future }))).toBe(`i:${ip}`);
  });

  it('refuses a signature of the wrong length, which timingSafeEqual would throw on', () => {
    // Header and payload both parse and the algorithm is right, so this reaches the
    // comparison — and a truncated HMAC is the input that makes `timingSafeEqual` raise
    // instead of returning false. The length is checked first precisely so it cannot.
    const [head, body, sig] = sign({ sub: 'cust-1', exp: future }).split('.');
    expect(at(`${head}.${body}.${sig.slice(0, 20)}`)).toBe(`i:${ip}`);
  });

  it('refuses a malformed token without throwing', () => {
    for (const bad of ['', 'a.b', 'a.b.c.d', '....', 'Bearer', '%%%.%%%.%%%']) {
      expect(at(bad)).toBe(`i:${ip}`);
    }
  });

  it('falls back to the address when no secret is configured at all', () => {
    // A deployment that never set JWT_ACCESS_SECRET limits coarsely; it is never bypassable.
    const at2 = sign({ sub: 'cust-1', exp: future });
    expect(rateLimitKey(req({ headers: { authorization: `Bearer ${at2}` }, ip }))).toBe(`i:${ip}`);
  });
});

describe('rateLimitKey · the anonymous fallback', () => {
  it('charges an anonymous caller to their address', () => {
    expect(keyOf({ ip: '203.0.113.5' })).toBe('i:203.0.113.5');
  });

  it('never returns an empty key when the address is missing', () => {
    // A key of `i:undefined` would silently collapse every such caller into ONE shared
    // counter — the per-deployment bucket B-2 exists to prevent.
    expect(keyOf({})).toBe('i:unknown');
  });
});
