import { timingSafeEqual } from 'crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { Role } from '../domain/role.enum';
import { AuthenticatedUser } from '../http/authenticated-user';
import { IS_PUBLIC_KEY } from './decorators';
import { INTERNAL_KEY_HEADER } from './internal-auth.guard';

/**
 * Global guard: verifies the Bearer access token (signed by auth-service) and
 * attaches the identity to the request. @Public() routes are skipped. Reads the
 * shared secret from the `JWT_ACCESS_SECRET` config key (convention across
 * services).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    // Trusted system principal: a caller presenting the shared internal service key
    // (used by trusted BFFs/service-to-service calls) is authenticated as SUPER_ADMIN
    // without a user JWT. Length-checked + timing-safe compare; fails closed when the
    // key is unconfigured. Only honored when a real key is set — never for a blank one.
    const configuredKey = this.config.get<string>('INTERNAL_SERVICE_KEY') ?? '';
    const providedKey = request.headers[INTERNAL_KEY_HEADER];
    if (
      configuredKey.length > 0 &&
      typeof providedKey === 'string' &&
      JwtAuthGuard.safeEqual(providedKey, configuredKey)
    ) {
      request.user = { sub: 'system', role: Role.SUPER_ADMIN, phone: null };
      return true;
    }

    const token = JwtAuthGuard.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    try {
      const payload = await this.jwt.verifyAsync<AuthenticatedUser>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      request.user = { sub: payload.sub, role: payload.role, phone: payload.phone };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }

  private static safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  private static extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) {
      return null;
    }
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
