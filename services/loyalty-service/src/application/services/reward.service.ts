import { Inject, Injectable } from '@nestjs/common';

import {
  InsufficientPointsError,
  RewardItemNotFoundError,
  RewardOutOfStockError,
} from '../../domain/errors';
import {
  RewardItemRecord,
  RewardRedemptionRecord,
  RewardRepository,
} from '../ports/reward.repository';
import { LOYALTY_TOKENS } from '../tokens';
import { LoyaltyService } from './loyalty.service';

export interface RedeemResult {
  redemption: RewardRedemptionRecord;
  /** Balance after the debit (unchanged on an idempotent replay). */
  pointsBalance: number;
}

/** Points-redeem catalog (FR-015): browse rewards and spend points for them. */
@Injectable()
export class RewardService {
  constructor(
    @Inject(LOYALTY_TOKENS.RewardRepository) private readonly rewards: RewardRepository,
    private readonly loyalty: LoyaltyService,
  ) {}

  listCatalog(): Promise<RewardItemRecord[]> {
    return this.rewards.listActiveItems();
  }

  /**
   * Spend points on a catalog item. Idempotent per `idempotencyKey`: a repeated
   * submit returns the original redemption without debiting again. A redemption
   * debits the spendable balance only — never lifetimePoints/tier.
   */
  async redeem(
    customerId: string,
    rewardItemId: string,
    idempotencyKey: string,
  ): Promise<RedeemResult> {
    const account = await this.loyalty.getAccount(customerId);

    const prior = await this.rewards.findRedemptionByKey(customerId, idempotencyKey);
    if (prior) {
      return { redemption: prior, pointsBalance: account.pointsBalance };
    }

    const item = await this.rewards.findItem(rewardItemId);
    if (!item || !item.active) {
      throw new RewardItemNotFoundError();
    }
    if (item.stock !== null && item.stock <= 0) {
      throw new RewardOutOfStockError();
    }
    if (account.pointsBalance < item.pointsCost) {
      throw new InsufficientPointsError();
    }

    const newBalance = account.pointsBalance - item.pointsCost;
    const redemption = await this.rewards.redeem({
      accountId: account.id,
      customerId,
      rewardItemId: item.id,
      idempotencyKey,
      pointsSpent: item.pointsCost,
      newBalance,
      reason: `Redeemed ${item.name}`,
      decrementStock: item.stock !== null,
    });
    return { redemption, pointsBalance: newBalance };
  }
}
