import { Inject, Injectable } from '@nestjs/common';

import { Customer } from '../../domain/customer/customer.entity';
import { InvalidRefreshTokenError, RefreshTokenRotatedError } from '../../domain/errors/auth.errors';
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
  /*
   * CA-3-57: the rotation family, so a client can recognise its OWN row.
   *
   * The devices list had no marker for "this is the phone you are holding", so the
   * dangerous entry and the harmless one looked identical — and the person most likely to
   * open this screen is somebody who thinks their account has been taken, deciding which
   * row to revoke. Revoking the wrong one signs them out and leaves the intruder in.
   *
   * The family id rather than the row id: a refresh ROTATES the row, so `id` changes under
   * the client every fifteen minutes while `familyId` stays put for the life of the device
   * session. It is issued to the client with its own tokens and identifies nothing but
   * itself.
   */
  familyId: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * How long after a rotation the OLD token is treated as "a concurrent request lost the race"
 * rather than as a stolen credential. Long enough for two tabs or a retry to land, short
 * enough that a thief replaying a captured token is still caught — and inside the window
 * nobody is issued anything, so the grace cannot be used to mint a session.
 */
const ROTATION_GRACE_MS = 30_000;

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

    // Reuse of a rotated/revoked token → treat the family as compromised — unless it was
    // rotated moments ago, which is two requests racing on the same cookie, not theft.
    // `replacedById` is what tells a rotation from a logout or a revoke-all.
    if (
      record.revokedAt &&
      record.replacedById &&
      now.getTime() - record.revokedAt.getTime() <= ROTATION_GRACE_MS
    ) {
      throw new RefreshTokenRotatedError();
    }

    if (record.revokedAt) {
      await this.refreshTokens.revokeFamily(record.familyId, now);
      throw new InvalidRefreshTokenError('This session was terminated for security reasons.');
    }

    if (record.expiresAt.getTime() <= now.getTime()) {
      throw new InvalidRefreshTokenError('The session has expired.');
    }

    /*
     * No idle limit here, on purpose — a session ends when it has gone unused for the
     * whole refresh lifetime (`JWT_REFRESH_TTL`, 30 days), which the expiry check above
     * already enforces, and at no earlier point.
     *
     * Every refresh mints a NEW token with a fresh lifetime, so that lifetime is a sliding
     * window: open the app once a month and you are never asked again. That is the rule the
     * business wants, because every sign-out costs one SMS OTP to get back in.
     *
     * An idle limit measured from `record.createdAt` cannot be made to fit under it. That
     * column is the time of the LAST REFRESH, not of the last request, and a refresh only
     * happens when the 15-minute access token has run out — so for anybody actively using
     * the app, "idle" is at least one access-token lifetime at every refresh. A limit at or
     * below that signs out exactly the people who are working. (It did: the first
     * deployment that made auth-service read the policy, with its 15-minute default, ended
     * every active session at the 15-minute mark.)
     */

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
      familyId: record.familyId,
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
      // CA-2-06: the same clock the idle check reads, so the interval is measured between
      // two stamps from one machine rather than across app-vs-database skew.
      createdAt: now,
    });

    if (replacesId) {
      await this.refreshTokens.revoke(replacesId, now, created.id);
    }

    const access = await this.signer.sign({
      sub: customer.id,
      role: customer.role,
      phone: customer.phone,
      depotId: customer.assignedDepotId ?? null,
    });

    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: rawRefreshToken,
      familyId,
      customer: toPublicCustomer(customer),
    };
  }
}
