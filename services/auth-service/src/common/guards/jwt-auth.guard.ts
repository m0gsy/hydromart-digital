import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import {
  EXTERNAL_ACCESS_KEY,
  EXTERNAL_TOKEN_ALGORITHM,
  MACHINE_ROLE,
  TOKEN_ALGORITHM,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  tokenAlgorithm,
  verifyExternalToken,
  type ExternalCaller,
} from '@hydromart/platform';

import { AuthConfigService } from '../../config/auth-config.service';
import { ExternalTokenSigner } from '../../infrastructure/security/external-token-signer';
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
    // Optional: a guard built by hand (older tests) simply admits no AI or machine token.
    @Optional() private readonly signer?: ExternalTokenSigner,
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

    // HD-21: an AI-web or machine token (ES256) is admitted only on a route that says
    // `@ExternalAccess`, verified against this service's own signing keys. The claimed `alg` only
    // picks which verifier runs; each pins its own algorithm.
    if (tokenAlgorithm(token) === EXTERNAL_TOKEN_ALGORITHM) {
      return this.admitExternal(context, request, token);
    }

    try {
      // AUTH-5: the fork of the shared guard checks the same three facts. A fork that drifts
      // is how a hardening lands everywhere except in the service that owns the tokens.
      const payload = await this.jwt.verifyAsync<AuthenticatedUser & { exp: number }>(token, {
        secret: this.config.tokenPolicy.accessSecret,
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        algorithms: [TOKEN_ALGORITHM],
      });
      request.user = {
        sub: payload.sub,
        role: payload.role,
        phone: payload.phone,
        depotId: payload.depotId ?? null,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }

  private admitExternal(context: ExecutionContext, request: Request, token: string): boolean {
    const claims = this.signer ? verifyExternalToken(token, this.signer.verificationKeys()) : null;
    if (!claims) throw new UnauthorizedException('Invalid or expired access token.');
    const allowed = this.reflector.getAllAndOverride<ExternalCaller[] | undefined>(EXTERNAL_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed?.includes(claims.via)) {
      throw new ForbiddenException('This endpoint does not accept AI or machine tokens.');
    }
    request.user = {
      sub: claims.sub,
      role: (claims.role ?? MACHINE_ROLE) as AuthenticatedUser['role'],
      phone: '',
      depotId: claims.depotId,
      via: claims.via,
      ...(claims.via === 'machine' ? { scopes: claims.scopes } : {}),
    } as AuthenticatedUser;
    return true;
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
