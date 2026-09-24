import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { getRequestContext } from '@hydromart/platform';

import { ApiKeyEnvironment } from '../domain/api-key-environment';
import { ipAllowed } from '../domain/ip-allowlist';
import { SecurityPolicyService } from '../application/services/security-policy.service';
import { hashApiKey } from '../domain/api-key-token';
import { ApiKeyRecord, ApiKeyRepository } from '../application/ports/api-key.repository';
import { ADMIN_TOKENS } from '../application/tokens';
import { AdminConfigService } from '../config/admin-config.service';

export const API_KEY_HEADER = 'x-api-key';
const SCOPES_KEY = 'apiKeyScopes';

/** Scopes a partner route requires. Every scope listed must be on the key. */
export const ApiScopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

/** The authenticated key, for handlers that need to know who called. */
export interface ApiKeyRequest extends Request {
  apiKey?: ApiKeyRecord;
}

/**
 * H-30: API keys used to be a registry — minted, displayed, revoked, and accepted by
 * nothing. This is the mechanism behind them.
 *
 * Only the sha256 of a key is stored, so authentication is a hash lookup: the presented
 * secret never has to be kept anywhere to be checked. Revoked keys fail closed, scopes are
 * enforced per route, and `lastUsedAt` is stamped so a key nobody uses is visible as such.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    @Inject(ADMIN_TOKENS.ApiKeyRepository) private readonly keys: ApiKeyRepository,
    private readonly reflector: Reflector,
    private readonly config: AdminConfigService,
    private readonly policies: SecurityPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const presented = request.headers[API_KEY_HEADER];
    const token = Array.isArray(presented) ? presented[0] : presented;
    if (!token) throw new UnauthorizedException('API key required');

    // Looked up by hash, so a wrong key and an unknown key take the same path and answer
    // the same thing — no oracle for whether a prefix exists.
    const key = await this.keys.findByHash(hashApiKey(token));
    if (!key) throw new UnauthorizedException('Invalid API key');
    if (key.revokedAt) throw new UnauthorizedException('API key revoked');
    /*
     * ADM-5, both halves.
     *
     * A key with no end outlives the integration it was minted for, the person who asked
     * for it, and the laptop it was pasted into — so an expiry is checked here rather than
     * trusted to a cleanup job that does not exist. Keys minted before the column existed
     * have none, and are left working: silently expiring a partner's live credential on
     * deploy is an outage, not a fix.
     *
     * And a TEST key is a test key. The prefix says `hm_test_…`, the console labels it
     * STAGING, and this guard accepted it against production data exactly like a live one —
     * so a credential handed out for a sandbox integration, with the care that implies, was
     * a production credential the whole time.
     */
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('API key expired');
    }
    if (this.config.isProduction && key.environment === ApiKeyEnvironment.STAGING) {
      throw new UnauthorizedException('Test API key cannot be used against production');
    }

    /*
     * ADM-6: the IP allowlist, read by something at last.
     *
     * It was written on the HQ security screen, stored here, and evaluated by nothing. This
     * is the surface admin-service owns end to end — its own keys, its own policy — so this
     * is where the list becomes real. The address comes from `getRequestContext`, which
     * trusts `x-forwarded-for` only from a private peer (CORE-3): an allowlist keyed on a
     * header the caller can type would be worse than none.
     */
    const policy = await this.policies.get();
    if (!ipAllowed(getRequestContext(request).ipAddress, policy.ipAllowlist)) {
      throw new ForbiddenException('API key is not allowed from this address');
    }

    const required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const missing = (required ?? []).filter((scope) => !key.scopes.includes(scope));
    if (missing.length > 0) {
      throw new ForbiddenException(`API key is missing scope(s): ${missing.join(', ')}`);
    }

    request.apiKey = key;
    // Best-effort: a stamp that fails must not fail the partner's request.
    this.keys
      .touchLastUsed(key.id, new Date())
      .catch((err: unknown) =>
        this.logger.warn(`lastUsedAt not stamped for ${key.keyPrefix}: ${String(err)}`),
      );
    return true;
  }
}
