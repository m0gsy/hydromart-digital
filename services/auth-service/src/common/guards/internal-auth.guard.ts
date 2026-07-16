import { timingSafeEqual } from 'crypto';

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { AuthConfigService } from '../../config/auth-config.service';

/** Header carrying the shared service-to-service secret. */
export const INTERNAL_KEY_HEADER = 'x-internal-key';

/**
 * Guards a service-to-service route with the shared INTERNAL_SERVICE_KEY (the same
 * secret auth-service uses for its outbound crm calls). Pair with @Public() so the
 * global JWT guard is skipped and this becomes the sole auth. Mirrors the
 * @hydromart/platform InternalAuthGuard in auth-service's local guard style.
 *
 * Fails CLOSED: no configured key, or a missing/wrong header ⇒ rejected. Comparison
 * is length-checked then timing-safe.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: AuthConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.internalServiceKey;
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
