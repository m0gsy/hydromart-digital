import {
  EXTERNAL_TOKEN_ALGORITHM,
  TOKEN_ALGORITHM,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
} from './token-claims';

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
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
import {
  EXTERNAL_ACCESS_KEY,
  MACHINE_ROLE,
  externalKeyStore,
  tokenAlgorithm,
  verifyExternalToken,
  type ExternalCaller,
} from './external-access';
import { INTERNAL_KEY_HEADER, matchesInternalServiceKey } from './internal-auth.guard';

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
    // without a user JWT. PLAT-5: checked against the current key OR the previous one
    // during a rotation window — see `matchesInternalServiceKey`. Only honored when at
    // least one real key is set — never for a blank one.
    const providedKey = request.headers[INTERNAL_KEY_HEADER];
    if (typeof providedKey === 'string' && matchesInternalServiceKey(providedKey, this.config)) {
      request.user = { sub: 'system', role: Role.SUPER_ADMIN, phone: null, depotId: null };
      return true;
    }

    const token = JwtAuthGuard.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    // HD-2: the claimed `alg` only picks which verifier runs; each pins its own algorithm,
    // so a token cannot talk the HS256 path into accepting it, or the reverse.
    if (tokenAlgorithm(token) === EXTERNAL_TOKEN_ALGORITHM) {
      return this.admitExternal(context, request, token);
    }

    try {
      // AUTH-5: the secret alone said only "somebody with the key signed this". These three
      // say it was OUR auth service, for THIS api, with the algorithm we chose.
      const payload = await this.jwt.verifyAsync<AuthenticatedUser>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
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

  /**
   * HD-2: an AI-web or machine token. Verified against the keys auth-service publishes (an
   * empty set is the kill switch), then admitted only where the route says `@ExternalAccess`
   * for that caller. 401 for a token we cannot verify, 403 for a good token on the wrong route.
   */
  private async admitExternal(
    context: ExecutionContext,
    request: Request,
    token: string,
  ): Promise<boolean> {
    const store = externalKeyStore(this.config.get<string>('AUTH_SERVICE_URL'));
    if (store) await store.refresh();
    const claims = store ? verifyExternalToken(token, store.current()) : null;
    if (!claims) {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
    const allowed = this.reflector.getAllAndOverride<ExternalCaller[] | undefined>(
      EXTERNAL_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed?.includes(claims.via)) {
      throw new ForbiddenException('This endpoint does not accept AI or machine tokens.');
    }
    request.user = {
      sub: claims.sub,
      role: (claims.role ?? MACHINE_ROLE) as Role,
      phone: null,
      depotId: claims.depotId,
      via: claims.via,
      ...(claims.via === 'machine' ? { scopes: claims.scopes } : {}),
    };
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
