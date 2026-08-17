import type { NextFunction, Request, Response } from 'express';

/**
 * A token bucket, replacing the two fixed windows it took to approximate one.
 *
 * A fixed window resets on a wall-clock boundary, so a caller who spends its whole quota in
 * the last second of one window and the whole of the next in the first has sent TWICE the
 * limit inside two seconds — entirely within the rules. The repo's answer was a second,
 * shorter window layered on top, which flattened that spike but bought it with a ceiling
 * that could refuse a legitimate burst: at 100/10s the e2e suite went red, because several
 * browsers browsing anonymously from one address share one bucket.
 *
 * A bucket has no boundary to exploit and no second ceiling to trip over. It holds
 * `capacity` tokens, refills continuously at `refillPerSecond`, and a request costs one.
 * So the SUSTAINED rate is the refill rate and the BURST allowance is the capacity — the two
 * numbers the two windows were each trying to express on their own.
 *
 * Deliberately in-memory, and correct for exactly one gateway process. Two replicas hold two
 * buckets and grant twice the rate between them; the trigger for moving to a shared store is
 * written down in DEPLOY.md rather than left to be discovered.
 */

export interface TokenBucketOptions {
  /** Burst allowance: the most a caller may spend at once. */
  capacity: number;
  /** Sustained rate. */
  refillPerSecond: number;
  keyGenerator: (req: Request) => string;
  skip?: (req: Request) => boolean;
  message?: string;
  /** Injected in tests; production uses the clock. */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Buckets are dropped once a caller has been idle long enough to have refilled completely —
 * at that point the entry says nothing a fresh one would not, so keeping it is pure leak.
 * High-cardinality anonymous traffic is exactly what makes an unbounded map dangerous here.
 */
const IDLE_SWEEP_EVERY = 1000;

/** The middleware, plus the one thing a test cannot otherwise see. */
export interface TokenBucketMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  /**
   * How many callers are being tracked. Exposed because the eviction below has no other
   * observable effect — a leak is invisible until the process dies of it, which is exactly
   * the kind of bug that ships.
   */
  trackedCallers(): number;
}

export function tokenBucket(options: TokenBucketOptions): TokenBucketMiddleware {
  const { capacity, refillPerSecond, keyGenerator, skip, message } = options;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();
  const fullAfterMs = (capacity / refillPerSecond) * 1000;
  let sinceSweep = 0;

  const middleware = function rateLimitByTokenBucket(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (skip?.(req)) {
      next();
      return;
    }
    const at = now();

    if (++sinceSweep >= IDLE_SWEEP_EVERY) {
      sinceSweep = 0;
      for (const [key, bucket] of buckets) {
        if (at - bucket.updatedAt >= fullAfterMs) buckets.delete(key);
      }
    }

    const key = keyGenerator(req);
    const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: at };
    // Refill for the time that passed, capped at capacity — an idle caller does not bank
    // credit beyond its burst allowance, which is what stops a quiet hour funding a flood.
    const refilled = Math.min(
      capacity,
      bucket.tokens + ((at - bucket.updatedAt) / 1000) * refillPerSecond,
    );
    bucket.updatedAt = at;

    if (refilled < 1) {
      bucket.tokens = refilled;
      buckets.set(key, bucket);
      // Retry-After is not decoration: the web client reads it and retries once (F-3), so a
      // 429 without it turns a wait into a failed screen.
      const waitSeconds = Math.max(1, Math.ceil((1 - refilled) / refillPerSecond));
      res.setHeader('Retry-After', String(waitSeconds));
      res.setHeader('RateLimit-Limit', String(capacity));
      res.setHeader('RateLimit-Remaining', '0');
      res.status(429).json({ statusCode: 429, message: message ?? 'Too many requests' });
      return;
    }

    bucket.tokens = refilled - 1;
    buckets.set(key, bucket);
    res.setHeader('RateLimit-Limit', String(capacity));
    res.setHeader('RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    next();
  };
  middleware.trackedCallers = () => buckets.size;
  return middleware;
}
