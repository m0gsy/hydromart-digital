import { Inject, Injectable } from '@nestjs/common';
import { CAPABILITIES, HQ_IDLE_LIMIT, type Role } from '@hydromart/access';

import { SecurityPolicyPort } from '../ports/security-policy.port';

import { Customer } from '../../domain/customer/customer.entity';
import {
  InvalidRefreshTokenError,
  RefreshTokenRotatedError,
} from '../../domain/errors/auth.errors';
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
    @Inject(AUTH_TOKENS.SecurityPolicy) private readonly securityPolicy: SecurityPolicyPort,
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
     * A session ends when it has gone unused for the whole refresh lifetime
     * (`JWT_REFRESH_TTL`, 30 days), which the expiry check above already enforces. Every
     * refresh mints a NEW token with a fresh lifetime, so that lifetime is a sliding window:
     * open the app once a month and you are never asked again. Every sign-out costs an SMS
     * OTP, so nobody is signed out earlier for idleness — with ONE exception, below.
     */

    const customer = await this.customers.findById(record.customerId);
    if (!customer) {
      throw new InvalidRefreshTokenError();
    }
    customer.ensureCanAuthenticate();

    await this.assertNotIdle(customer, record.createdAt, record.familyId, now);

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
   * The idle limit head office set — for head-office accounts only.
   *
   * CA-2-06 applied it to everybody, measured from `createdAt` (the last REFRESH, not the
   * last request). A refresh only happens when the access token has run out, so for anybody
   * using the app that interval is at least one access-token lifetime at every refresh: a
   * 15-minute limit ended every active session at the 15-minute mark. Two corrections:
   *
   *  - the access-token lifetime is subtracted, so a continuously used session measures ~0.
   *    What is left is a floor on the real inactivity — it can under-state idleness by up to
   *    one access-token lifetime, never over-state it — hence `HQ_IDLE_LIMIT.min`.
   *  - it applies only to roles that hold `hqConsole`. A customer or a courier is never
   *    signed out for idleness; see `HQ_IDLE_LIMIT`.
   *
   * Off unless head office turned it on (`null`), and also off when the policy cannot be
   * read: neither is a reason to sign anybody out.
   */
  private async assertNotIdle(
    customer: Customer,
    lastRefreshedAt: Date,
    familyId: string,
    now: Date,
  ): Promise<void> {
    if (!(CAPABILITIES.hqConsole as readonly Role[]).includes(customer.role as unknown as Role)) {
      return;
    }
    const limit = await this.securityPolicy.idleTimeoutMinutes();
    if (limit === null || limit < HQ_IDLE_LIMIT.min) return;

    const accessMs = this.config.tokenPolicy.accessTtlSeconds * 1000;
    const idleMs = now.getTime() - lastRefreshedAt.getTime() - accessMs;
    if (idleMs > limit * 60_000) {
      // The family goes with it: an abandoned session should not be resumable from another
      // device holding an older token in the same chain.
      await this.refreshTokens.revokeFamily(familyId, now);
      throw new InvalidRefreshTokenError('The session was idle for too long.');
    }
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
