import { timingSafeEqual } from 'crypto';

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/** Header carrying the shared service-to-service secret. */
export const INTERNAL_KEY_HEADER = 'x-internal-key';

/**
 * Guards a service-to-service route with a shared secret (the `INTERNAL_SERVICE_KEY`
 * config key). Pair with `@Public()` so the global JWT guard is skipped and this
 * becomes the sole auth. Use for system-triggered calls that have no end-user token
 * (payment webhooks, registration welcome, cross-service events).
 *
 * Fails CLOSED: if no key is configured, or the header is missing or wrong, the
 * request is rejected. Comparison is length-checked then timing-safe so neither the
 * key's value nor its length leaks through response timing.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('INTERNAL_SERVICE_KEY') ?? '';
    const provided = context.switchToHttp().getRequest<Request>().headers[INTERNAL_KEY_HEADER];
    if (
      configured.length === 0 ||
      typeof provided !== 'string' ||
      !InternalAuthGuard.safeEqual(provided, configured)
    ) {
      throw new UnauthorizedException('Invalid internal service key.');
    }
    return true;
  }

  private static safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }
}
