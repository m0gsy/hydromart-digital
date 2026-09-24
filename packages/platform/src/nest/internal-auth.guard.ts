import { timingSafeEqual } from 'crypto';

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/** Header carrying the shared service-to-service secret. */
export const INTERNAL_KEY_HEADER = 'x-internal-key';

/** Length-checked then timing-safe, so neither a key's value nor its length leaks via timing. */
export function safeEqualSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * PLAT-5 — the rotation half. `INTERNAL_SERVICE_KEY` used to be the only value either
 * guard would accept, which meant rotating it was a flag day: change it on one service and
 * every OTHER service's calls to that one break until all seventeen are redeployed with the
 * new value at once. Nobody was ever going to do that under load, so the key never rotated.
 *
 * `INTERNAL_SERVICE_KEY_PREVIOUS` is accepted alongside the current one, so a rotation is a
 * two-step roll instead of a flag day: move the old value into `_PREVIOUS`, put a new value
 * in `INTERNAL_SERVICE_KEY`, redeploy every service at whatever pace CI/CD actually allows —
 * callers still presenting the old key keep working throughout — then once every service is
 * confirmed on the new value, clear `_PREVIOUS`. Blank (the default) accepts nothing extra,
 * so a box that has never rotated behaves exactly as before.
 *
 * What this does NOT close: the key is still ONE secret that authenticates as SUPER_ADMIN
 * on every one of the seventeen services that read it (see `JwtAuthGuard`) — rotatable now,
 * still unscoped. Narrowing that to a per-caller identity is a real access-control design
 * question (what would the scopes even be?), not a mechanical fix, and is left open — see
 * PLAT-5's register entry.
 */
export function matchesInternalServiceKey(provided: string, config: ConfigService): boolean {
  const current = config.get<string>('INTERNAL_SERVICE_KEY') ?? '';
  const previous = config.get<string>('INTERNAL_SERVICE_KEY_PREVIOUS') ?? '';
  return (
    (current.length > 0 && safeEqualSecret(provided, current)) ||
    (previous.length > 0 && safeEqualSecret(provided, previous))
  );
}

/**
 * Guards a service-to-service route with a shared secret (the `INTERNAL_SERVICE_KEY` /
 * `INTERNAL_SERVICE_KEY_PREVIOUS` config keys). Pair with `@Public()` so the global JWT
 * guard is skipped and this becomes the sole auth. Use for system-triggered calls that have
 * no end-user token (payment webhooks, registration welcome, cross-service events).
 *
 * Fails CLOSED: if neither key is configured, or the header is missing or matches neither,
 * the request is rejected.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const provided = context.switchToHttp().getRequest<Request>().headers[INTERNAL_KEY_HEADER];
    if (typeof provided !== 'string' || !matchesInternalServiceKey(provided, this.config)) {
      throw new UnauthorizedException('Invalid internal service key.');
    }
    return true;
  }
}
