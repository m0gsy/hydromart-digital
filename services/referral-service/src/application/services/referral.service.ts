import { Inject, Injectable, Logger } from '@nestjs/common';

import { ReferralConfigService } from '../../config/referral-config.service';
import { generateReferralCode, normalizeCode } from '../../domain/referral-code';
import { ReferralStatus } from '../../domain/referral-status';
import {
  AlreadyReferredError,
  ReferralCodeNotFoundError,
  SelfReferralError,
} from '../../domain/errors';
import { Page, buildPage } from '../pagination';
import { LoyaltyRewardPort } from '../ports/loyalty-reward.port';
import {
  ReferralCodeRecord,
  ReferralRecord,
  ReferralRepository,
} from '../ports/referral.repository';
import { REFERRAL_TOKENS } from '../tokens';

const REFERRER_REASON = 'Referral reward: referred a new customer';
const REFEREE_REASON = 'Referral welcome bonus';

export interface ReferralSummary {
  code: ReferralCodeRecord;
  referrals: Page<ReferralRecord>;
  referredCount: number;
  qualifiedCount: number;
  pointsEarned: number;
}

export interface QualifyResult {
  qualified: boolean;
  referral?: ReferralRecord;
}

@Injectable()
export class ReferralService {
  private static readonly MAX_LIMIT = 100;
  private static readonly CODE_RETRIES = 5;
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @Inject(REFERRAL_TOKENS.ReferralRepository) private readonly repo: ReferralRepository,
    @Inject(REFERRAL_TOKENS.LoyaltyReward) private readonly loyalty: LoyaltyRewardPort,
    private readonly config: ReferralConfigService,
  ) {}

  /** Read a customer's referral code, lazily creating a unique one on first touch. */
  async getOrCreateMyCode(customerId: string): Promise<ReferralCodeRecord> {
    const existing = await this.repo.findCodeByCustomer(customerId);
    if (existing) return existing;

    for (let attempt = 0; attempt < ReferralService.CODE_RETRIES; attempt += 1) {
      const code = generateReferralCode();
      if (await this.repo.findCodeByCode(code)) continue;
      try {
        return await this.repo.createCode(customerId, code);
      } catch {
        // Lost a race (unique collision on customerId or code); re-read and retry.
        const raced = await this.repo.findCodeByCustomer(customerId);
        if (raced) return raced;
      }
    }
    throw new Error('Could not generate a unique referral code.');
  }

  private clampPage(page = 1, limit = 20): { p: number; l: number } {
    return {
      p: Math.max(1, page),
      l: Math.min(ReferralService.MAX_LIMIT, Math.max(1, limit)),
    };
  }

  private async summaryFor(customerId: string, page = 1, limit = 20): Promise<ReferralSummary> {
    const { p, l } = this.clampPage(page, limit);
    const code = await this.getOrCreateMyCode(customerId);
    const { items, total } = await this.repo.listReferralsByReferrer(customerId, p, l);
    const counts = await this.repo.summarizeReferrer(customerId);
    return {
      code,
      referrals: buildPage(items, total, p, l),
      referredCount: counts.referredCount,
      qualifiedCount: counts.qualifiedCount,
      pointsEarned: counts.pointsEarned,
    };
  }

  /** Current customer's own referral summary (code + referrals-as-referrer + counts). */
  getMySummary(customerId: string, page = 1, limit = 20): Promise<ReferralSummary> {
    return this.summaryFor(customerId, page, limit);
  }

  /** Staff read: same summary shape for an arbitrary customer. */
  getCustomerSummary(customerId: string, page = 1, limit = 20): Promise<ReferralSummary> {
    return this.summaryFor(customerId, page, limit);
  }

  /**
   * A new customer redeems a referral code, creating a PENDING referral. Rejects using
   * your own code (SelfReferralError) and being referred twice (AlreadyReferredError).
   */
  async redeem(refereeCustomerId: string, rawCode: string): Promise<ReferralRecord> {
    const code = normalizeCode(rawCode);
    const codeRecord = await this.repo.findCodeByCode(code);
    if (!codeRecord) throw new ReferralCodeNotFoundError();
    if (codeRecord.customerId === refereeCustomerId) throw new SelfReferralError();

    const existing = await this.repo.findReferralByReferee(refereeCustomerId);
    if (existing) throw new AlreadyReferredError();

    return this.repo.createReferral({
      referrerCustomerId: codeRecord.customerId,
      refereeCustomerId,
      code: codeRecord.code,
    });
  }

  /**
   * Mark the referee's PENDING referral as QUALIFIED on their first qualifying order and
   * award both parties loyalty points (FR-092). Idempotent: no pending referral, or a
   * lost race on the atomic transition, is a no-op. Loyalty rewards fail open — a loyalty
   * outage never blocks qualification (rewards fire once, inside the PENDING->QUALIFIED
   * transition, so retries do not double-award).
   */
  async qualify(
    refereeCustomerId: string,
    orderId: string,
    authorization: string,
  ): Promise<QualifyResult> {
    const referral = await this.repo.findReferralByReferee(refereeCustomerId);
    if (!referral || referral.status !== ReferralStatus.PENDING) {
      return { qualified: false };
    }

    const referrerPoints = this.config.referrerPoints;
    const refereePoints = this.config.refereePoints;
    const updated = await this.repo.qualifyReferral(
      referral.id,
      orderId,
      referrerPoints,
      refereePoints,
    );
    if (!updated) return { qualified: false };

    // The transition is already committed; a reward failure must never undo it, so both
    // rewards are fired fail-open (the port swallows outages too — belt and suspenders).
    await this.safeReward(updated.referrerCustomerId, referrerPoints, REFERRER_REASON, authorization);
    await this.safeReward(updated.refereeCustomerId, refereePoints, REFEREE_REASON, authorization);

    this.logger.log(
      `Referral ${updated.id} qualified via order ${orderId}: +${referrerPoints}/${refereePoints} pts`,
    );
    return { qualified: true, referral: updated };
  }

  private async safeReward(
    customerId: string,
    points: number,
    reason: string,
    authorization: string,
  ): Promise<void> {
    try {
      await this.loyalty.reward(customerId, points, reason, authorization);
    } catch (error) {
      this.logger.warn(`Loyalty reward failed for customer ${customerId}: ${(error as Error).message}`);
    }
  }
}
