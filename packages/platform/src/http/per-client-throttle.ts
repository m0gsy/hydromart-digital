import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { INTERNAL_KEY_HEADER, safeEqualSecret } from '../nest/internal-auth.guard';
import { getRequestContext } from './request-context';

/**
 * The rate-limit tracker a backend service uses, instead of Nest's default `req.ip`.
 *
 * Every backend service sits behind the gateway, so the socket peer of EVERY request is the
 * gateway container. The default tracker keys on that, which turns the per-IP limit into one
 * counter shared by all users of the service: with the stock limit of 100 a hundred-and-first
 * request in a minute from anyone is a 429, however many different customers made them.
 *
 * `getRequestContext` already answers "who is the client" for the audit trail: the first
 * `x-forwarded-for` hop, believed only when the socket peer is one of our own private
 * addresses, otherwise the socket address itself.
 */
export function clientIpTracker(req: Record<string, unknown>): string {
  return getRequestContext(req as unknown as Request).ipAddress ?? 'unknown';
}

/**
 * Whether a request carries the service-to-service secret (current or previous, as
 * `matchesInternalServiceKey` accepts during a rotation).
 *
 * Service-to-service calls are not clients: they arrive from a peer that is another service,
 * with no `x-forwarded-for`, so they would all be counted against that one peer. Checkout
 * makes several of them per order, and the adapters that make them fail OPEN, so a limiter
 * applied to them would not return errors, it would silently drop a promo or a discount.
 * The header is compared, not merely present: a bare `x-internal-key: x` on a public route
 * must not switch the limiter off.
 */
export function isInternalCall(
  context: ExecutionContext,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const provided = context.switchToHttp().getRequest<Request>().headers?.[INTERNAL_KEY_HEADER];
  if (typeof provided !== 'string' || provided.length === 0) return false;
  return [env.INTERNAL_SERVICE_KEY, env.INTERNAL_SERVICE_KEY_PREVIOUS].some(
    (key) => !!key && safeEqualSecret(provided, key),
  );
}

/**
 * The module options every service's `ThrottlerModule.forRootAsync` returns: the same
 * `[{ ttl, limit }]` the service always had, plus the per-client tracker and the internal
 * bypass. Generic over the throttler entry so the platform package needs no throttler import.
 */
export function perClientThrottle<T>(throttlers: T[]): {
  throttlers: T[];
  getTracker: (req: Record<string, unknown>) => string;
  skipIf: (context: ExecutionContext) => boolean;
} {
  return {
    throttlers,
    getTracker: clientIpTracker,
    skipIf: (context) => isInternalCall(context),
  };
}
