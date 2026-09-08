import type { NextFunction, Request, Response } from 'express';

import { tokenBucket } from '../../src/rate-limit/token-bucket';

/*
 * The bucket is tested with an INJECTED CLOCK, not over HTTP.
 *
 * Refill is a function of elapsed time, so an HTTP test of it races the machine it runs on:
 * three supertest calls take somewhere between 5 and 60 ms, and whether a fourth is refused
 * depends on which. The previous version of this behaviour was asserted that way and was one
 * slow runner away from flaking — which for a limiter means "re-run until green", the habit
 * that makes a gate worthless.
 *
 * So time is a parameter here, and every assertion below is exact.
 */
describe('tokenBucket', () => {
  const call = (mw: ReturnType<typeof tokenBucket>, ip = '198.51.100.1') => {
    const headers: Record<string, string> = {};
    let status = 0;
    let body: unknown;
    let passed = false;
    const req = { ip, path: '/orders/api/v1/x' } as unknown as Request;
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      status: (s: number) => {
        status = s;
        return res;
      },
      json: (b: unknown) => {
        body = b;
        return res;
      },
    } as unknown as Response;
    mw(req, res, (() => {
      passed = true;
    }) as NextFunction);
    return { passed, status, headers, body };
  };

  it('spends capacity and then refuses — capacity is the burst allowance', () => {
    const mw = tokenBucket({
      capacity: 3,
      refillPerSecond: 0.01,
      keyGenerator: () => 'k',
      now: () => 0,
    });
    expect(call(mw).passed).toBe(true);
    expect(call(mw).passed).toBe(true);
    expect(call(mw).passed).toBe(true);
    const refused = call(mw);
    expect(refused.passed).toBe(false);
    expect(refused.status).toBe(429);
  });

  it('refills over time at the sustained rate, and not faster', () => {
    let clock = 0;
    const mw = tokenBucket({
      capacity: 2,
      refillPerSecond: 1,
      keyGenerator: () => 'k',
      now: () => clock,
    });
    call(mw);
    call(mw);
    expect(call(mw).passed).toBe(false);
    clock = 999; // just under a second: still nothing to spend
    expect(call(mw).passed).toBe(false);
    clock = 1000; // exactly one token back
    expect(call(mw).passed).toBe(true);
    expect(call(mw).passed).toBe(false);
  });

  it('never banks more than capacity, so a quiet hour cannot fund a flood', () => {
    let clock = 0;
    const mw = tokenBucket({
      capacity: 2,
      refillPerSecond: 1,
      keyGenerator: () => 'k',
      now: () => clock,
    });
    clock = 3_600_000; // an hour of silence
    expect(call(mw).passed).toBe(true);
    expect(call(mw).passed).toBe(true);
    expect(call(mw).passed).toBe(false);
  });

  it('has no wall-clock boundary to double up across — the whole reason it replaced a window', () => {
    let clock = 0;
    // A fixed window of 2 per 10s would allow 2 at t=9.999s and 2 more at t=10.001s: four
    // requests inside two milliseconds, entirely within the rules. The bucket allows two.
    const mw = tokenBucket({
      capacity: 2,
      refillPerSecond: 0.2,
      keyGenerator: () => 'k',
      now: () => clock,
    });
    clock = 9_999;
    expect(call(mw).passed).toBe(true);
    expect(call(mw).passed).toBe(true);
    clock = 10_001;
    expect(call(mw).passed).toBe(false);
  });

  it('keys per caller, so one spike is not an outage for everybody else', () => {
    const mw = tokenBucket({
      capacity: 1,
      refillPerSecond: 0.01,
      keyGenerator: (req) => `k:${req.ip}`,
      now: () => 0,
    });
    expect(call(mw, '1.1.1.1').passed).toBe(true);
    expect(call(mw, '1.1.1.1').passed).toBe(false);
    expect(call(mw, '2.2.2.2').passed).toBe(true);
  });

  it('sends Retry-After, because the web client reads it and retries once (F-3)', () => {
    const mw = tokenBucket({
      capacity: 1,
      refillPerSecond: 0.5,
      keyGenerator: () => 'k',
      now: () => 0,
    });
    call(mw);
    const refused = call(mw);
    // One token at half a token per second is two seconds away.
    expect(refused.headers['Retry-After']).toBe('2');
    /*
     * CA-3-36. `code` is the field the web client translates on (`errors.byCode.*`), and
     * this body had none — so an Indonesian screen printed the English literal below, most
     * often on the OTP screen where the limiter bites hardest. Every Nest service already
     * maps HTTP 429 to this same code in `all-exceptions.filter.ts`; the gateway is raw
     * express middleware that never passes through that filter, so it was the one gap.
     *
     * Still `toEqual`, not `toMatchObject`: the exact shape is the contract, and a field
     * appearing here by accident is worth failing over.
     */
    expect(refused.body).toEqual({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    });
  });

  it('reports the ceiling and what is left, so a client can pace itself', () => {
    const mw = tokenBucket({
      capacity: 5,
      refillPerSecond: 1,
      keyGenerator: () => 'k',
      now: () => 0,
    });
    const first = call(mw);
    expect(first.headers['RateLimit-Limit']).toBe('5');
    expect(first.headers['RateLimit-Remaining']).toBe('4');
  });

  it('carries its own message AND code when given them, for the tier that guards a bill', () => {
    const mw = tokenBucket({
      capacity: 1,
      refillPerSecond: 0.01,
      keyGenerator: () => 'k',
      message: 'Too many verification requests',
      code: 'RATE_LIMITED_OTP',
      now: () => 0,
    });
    call(mw);
    // CA-3-36: the OTP tier keeps its own code as well as its own sentence, so the screen
    // that hits this limiter hardest says "verification" rather than the general line.
    expect(call(mw).body).toEqual({
      statusCode: 429,
      code: 'RATE_LIMITED_OTP',
      message: 'Too many verification requests',
    });
  });

  it('skips what it is told to skip, without spending a token', () => {
    const mw = tokenBucket({
      capacity: 1,
      refillPerSecond: 0.01,
      keyGenerator: () => 'k',
      skip: (req) => req.path === '/orders/api/v1/x',
      now: () => 0,
    });
    expect(call(mw).passed).toBe(true);
    expect(call(mw).passed).toBe(true); // the token was never taken
  });

  it('forgets a caller once it has refilled completely — an unbounded map is the other leak', () => {
    let clock = 0;
    const mw = tokenBucket({
      capacity: 1,
      refillPerSecond: 1,
      keyGenerator: (req) => `k:${req.ip}`,
      now: () => clock,
    });
    // A thousand distinct callers is the sweep interval, so the thousandth call sweeps — and
    // at clock 0 nothing is stale, so nothing is dropped.
    for (let i = 0; i < 1000; i += 1) call(mw, `10.0.${Math.floor(i / 250)}.${i % 250}`);
    expect(mw.trackedCallers()).toBe(1000);

    // Long enough for every one of them to have refilled completely: their entries now say
    // nothing a fresh entry would not, so the next sweep drops them.
    clock = 10_000;
    for (let i = 0; i < 1000; i += 1) call(mw, `10.1.${Math.floor(i / 250)}.${i % 250}`);
    expect(mw.trackedCallers()).toBeLessThanOrEqual(1000);

    // And the behaviour eviction must never break: a forgotten caller is a caller with its
    // full allowance, which is what it would have had anyway.
    expect(call(mw, '10.0.0.1').passed).toBe(true);
  });

  it('uses the real clock when none is injected', () => {
    const mw = tokenBucket({ capacity: 1, refillPerSecond: 0.01, keyGenerator: () => 'k' });
    expect(call(mw).passed).toBe(true);
    expect(call(mw).passed).toBe(false);
  });
});
