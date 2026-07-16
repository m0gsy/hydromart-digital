import { Inject, Injectable } from '@nestjs/common';

import { Customer } from '../../domain/customer/customer.entity';
import { InvalidRefreshTokenError } from '../../domain/errors/auth.errors';
import { AuthConfigService } from '../../config/auth-config.service';
import { AccessTokenSignerPort } from '../ports/access-token-signer.port';
import { ClockPort } from '../ports/clock.port';
import { CryptoPort } from '../ports/crypto.port';
import { CustomerRepository } from '../ports/customer.repository';
import { RefreshTokenRepository } from '../ports/refresh-token.repository';
import { AUTH_TOKENS } from '../tokens';
import { RequestContext, SessionResult, toPublicCustomer } from '../results';

/** Public view of an active device session (FR-010). */
export interface SessionInfo {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Issues and manages refresh-token sessions with rotation and reuse detection.
 *
 * Each login creates a new session "family". Every refresh rotates the token
 * (old one revoked, new one issued in the same family). Presenting an
 * already-rotated/revoked token is treated as theft: the whole family is revoked.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(AUTH_TOKENS.RefreshTokenRepository)
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    @Inject(AUTH_TOKENS.AccessTokenSignerPort) private readonly signer: AccessTokenSignerPort,
    @Inject(AUTH_TOKENS.CryptoPort) private readonly crypto: CryptoPort,
    @Inject(AUTH_TOKENS.ClockPort) private readonly clock: ClockPort,
    private readonly config: AuthConfigService,
  ) {}

  /** Issue a brand-new session for a freshly authenticated customer. */
  async issueForCustomer(customer: Customer, ctx: RequestContext): Promise<SessionResult> {
    const familyId = this.crypto.uuid();
    return this.mintSession(customer, familyId, ctx);
  }

  /** Rotate a refresh token, returning a new access + refresh pair. */
  async refresh(rawRefreshToken: string, ctx: RequestContext): Promise<SessionResult> {
    const now = this.clock.now();
    const tokenHash = this.crypto.hashToken(rawRefreshToken);
    const record = await this.refreshTokens.findByTokenHash(tokenHash);

    if (!record) {
      throw new InvalidRefreshTokenError();
    }

    // Reuse of a rotated/revoked token → treat the family as compromised.
    if (record.revokedAt) {
      await this.refreshTokens.revokeFamily(record.familyId, now);
      throw new InvalidRefreshTokenError('This session was terminated for security reasons.');
    }

    if (record.expiresAt.getTime() <= now.getTime()) {
      throw new InvalidRefreshTokenError('The session has expired.');
    }

    const customer = await this.customers.findById(record.customerId);
    if (!customer) {
      throw new InvalidRefreshTokenError();
    }
    customer.ensureCanAuthenticate();

    const session = await this.mintSession(customer, record.familyId, ctx, record.id);
    return session;
  }

  /** Revoke a single session by its refresh token (logout, FR-008). */
  async revokeByToken(rawRefreshToken: string): Promise<void> {
    const now = this.clock.now();
    const tokenHash = this.crypto.hashToken(rawRefreshToken);
    const record = await this.refreshTokens.findByTokenHash(tokenHash);
    if (record && !record.revokedAt) {
      await this.refreshTokens.revoke(record.id, now);
    }
  }

  /** Revoke every active session for a customer (logout everywhere, FR-010). */
  async revokeAll(customerId: string): Promise<void> {
    await this.refreshTokens.revokeAllForCustomer(customerId, this.clock.now());
  }

  /**
   * Revoke a single session the customer owns (by the session record id from
   * listActive). Revokes the whole rotation family so a rotated token can't survive.
   * Returns false when the id is not one of the caller's active sessions.
   */
  async revokeSession(customerId: string, sessionId: string): Promise<boolean> {
    const records = await this.refreshTokens.listActiveForCustomer(customerId, this.clock.now());
    const target = records.find((r) => r.id === sessionId);
    if (!target) return false;
    await this.refreshTokens.revokeFamily(target.familyId, this.clock.now());
    return true;
  }

  /** List active sessions for a customer (FR-010 multi-device management). */
  async listActive(customerId: string): Promise<SessionInfo[]> {
    const records = await this.refreshTokens.listActiveForCustomer(customerId, this.clock.now());
    return records.map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
    }));
  }

  /**
   * Create the refresh-token record and sign the access token. When `replacesId`
   * is provided, the previous token is revoked and linked to the new one.
   */
  private async mintSession(
    customer: Customer,
    familyId: string,
    ctx: RequestContext,
    replacesId?: string,
  ): Promise<SessionResult> {
    const now = this.clock.now();
    const { refreshTtlSeconds } = this.config.tokenPolicy;

    const rawRefreshToken = this.crypto.generateOpaqueToken();
    const tokenHash = this.crypto.hashToken(rawRefreshToken);
    const expiresAt = new Date(now.getTime() + refreshTtlSeconds * 1000);

    const created = await this.refreshTokens.create({
      customerId: customer.id,
      tokenHash,
      familyId,
      expiresAt,
      userAgent: ctx.userAgent,
      ipAddress: ctx.ipAddress,
    });

    if (replacesId) {
      await this.refreshTokens.revoke(replacesId, now, created.id);
    }

    const access = await this.signer.sign({
      sub: customer.id,
      role: customer.role,
      phone: customer.phone,
    });

    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: rawRefreshToken,
      customer: toPublicCustomer(customer),
    };
  }
}
