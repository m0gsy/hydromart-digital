import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { AuthConfigService } from '../../config/auth-config.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global guard: verifies the Bearer access token and attaches the identity to the
 * request. Routes decorated with @Public() are skipped (secure by default).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AuthConfigService,
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
    const token = JwtAuthGuard.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    try {
      const payload = await this.jwt.verifyAsync<AuthenticatedUser & { exp: number }>(token, {
        secret: this.config.tokenPolicy.accessSecret,
      });
      request.user = { sub: payload.sub, role: payload.role, phone: payload.phone };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
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
