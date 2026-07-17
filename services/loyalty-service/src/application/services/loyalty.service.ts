import { Inject, Injectable, Logger } from '@nestjs/common';

import { LoyaltyConfigService } from '../../config/loyalty-config.service';
import { InvalidAdjustmentError } from '../../domain/errors';
import { TIER_BENEFITS, TierBenefit, tierFor } from '../../domain/membership';
import { PointsTxnType, expiryFrom, pointsForOrder } from '../../domain/points';
import { Page, buildPage } from '../pagination';
import {
  LoyaltyAccountRecord,
  LoyaltyRepository,
  PointsTransactionRecord,
} from '../ports/loyalty.repository';
import { LOYALTY_TOKENS } from '../tokens';

export interface EarnResult {
  account: LoyaltyAccountRecord;
  pointsEarned: number;
  /** True when this order had already earned — the call was a no-op (idempotent). */
  alreadyEarned: boolean;
}

export interface ExpiryResult {
  lotsExpired: number;
  pointsExpired: number;
}

@Injectable()
export class LoyaltyService {
  private static readonly MAX_LIMIT = 100;
  private static readonly EXPIRY_BATCH = 500;
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    @Inject(LOYALTY_TOKENS.LoyaltyRepository) private readonly repo: LoyaltyRepository,
    private readonly config: LoyaltyConfigService,
  ) {}

  /** Read a customer's account, lazily creating it on first touch. */
  async getAccount(customerId: string): Promise<LoyaltyAccountRecord> {
    return (await this.repo.findAccount(customerId)) ?? (await this.repo.createAccount(customerId));
  }

  getTiers(): readonly TierBenefit[] {
    return TIER_BENEFITS;
  }

  /** HQ broadcast reach: how many customers are enrolled in loyalty. */
  async countMembers(): Promise<number> {
    return this.repo.countAccounts();
  }

  async listTransactions(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<Page<PointsTransactionRecord>> {
    const p = Math.max(1, page);
    const l = Math.min(LoyaltyService.MAX_LIMIT, Math.max(1, limit));
    const { items, total } = await this.repo.listTransactions(customerId, p, l);
    return buildPage(items, total, p, l);
  }

  /**
   * Award points for a completed order (BR-013). Idempotent per order: a repeated
   * call for the same orderId is a no-op. A zero-point order (tiny subtotal) records
   * nothing but still reads as handled.
   */
  async earnForOrder(customerId: string, orderId: string, subtotal: number): Promise<EarnResult> {
    const existing = await this.repo.findEarnByOrder(orderId);
    if (existing) {
      return { account: await this.getAccount(customerId), pointsEarned: 0, alreadyEarned: true };
    }

    const points = pointsForOrder(subtotal, this.config.earnRateRupiah);
    const account = await this.getAccount(customerId);
    if (points <= 0) {
      return { account, pointsEarned: 0, alreadyEarned: false };
    }

    const newLifetime = account.lifetimePoints + points;
    const updated = await this.repo.recordEarn({
      accountId: account.id,
      customerId,
      points,
      orderId,
      reason: `Order ${orderId} completed`,
      expiresAt: expiryFrom(new Date(), this.config.pointExpiryMonths),
      newBalance: account.pointsBalance + points,
      newLifetime,
      newTier: tierFor(newLifetime),
    });
    return { account: updated, pointsEarned: points, alreadyEarned: false };
  }

  /**
   * Manual signed correction (staff). Positive counts toward lifetime/tier; the
   * balance may never go negative.
   */
  async adjust(customerId: string, points: number, reason: string): Promise<LoyaltyAccountRecord> {
    const account = await this.getAccount(customerId);
    const newBalance = account.pointsBalance + points;
    if (newBalance < 0) throw new InvalidAdjustmentError();
    const newLifetime = account.lifetimePoints + Math.max(0, points);
    return this.repo.recordAdjustment({
      type: PointsTxnType.ADJUST,
      accountId: account.id,
      customerId,
      points,
      reason,
      newBalance,
      newLifetime,
      newTier: tierFor(newLifetime),
    });
  }

  /**
   * Grant a flat positive reward (e.g. a referral bonus). Counts toward
   * lifetime/tier like an EARN, but is not tied to an order subtotal. Callers
   * (other services) guarantee single-award idempotency; this method always
   * records. `points` must be positive (enforced at the DTO boundary).
   */
  async reward(customerId: string, points: number, reason: string): Promise<LoyaltyAccountRecord> {
    const account = await this.getAccount(customerId);
    const newLifetime = account.lifetimePoints + points;
    return this.repo.recordAdjustment({
      type: PointsTxnType.REWARD,
      accountId: account.id,
      customerId,
      points,
      reason,
      newBalance: account.pointsBalance + points,
      newLifetime,
      newTier: tierFor(newLifetime),
    });
  }

  /**
   * Sweep expired point lots (BR-014). Each due EARN lot becomes a matching negative
   * EXPIRE entry and is marked swept, decrementing the account balance. Idempotent —
   * a swept lot is never picked up again. Meant to be run on a schedule.
   */
  async runExpiry(now: Date = new Date()): Promise<ExpiryResult> {
    const lots = await this.repo.findExpirableLots(now, LoyaltyService.EXPIRY_BATCH);
    let pointsExpired = 0;
    for (const lot of lots) {
      const account = await this.repo.findAccount(lot.customerId);
      if (!account) continue;
      const newBalance = Math.max(0, account.pointsBalance - lot.points);
      await this.repo.recordExpiry({
        lotId: lot.id,
        accountId: account.id,
        customerId: lot.customerId,
        points: lot.points,
        newBalance,
      });
      pointsExpired += lot.points;
    }
    if (lots.length > 0) {
      this.logger.log(`Expired ${pointsExpired} points across ${lots.length} lots`);
    }
    return { lotsExpired: lots.length, pointsExpired };
  }
}
