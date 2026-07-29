import { Inject, Injectable } from '@nestjs/common';

import {
  InsufficientPointsError,
  RewardAlreadyCancelledError,
  RewardAlreadyUsedError,
  RewardItemNotFoundError,
  RewardOutOfStockError,
  RewardRedemptionNotFoundError,
} from '../../domain/errors';
import {
  CreateRewardItemData,
  RewardItemRecord,
  RewardRedemptionRecord,
  RewardRedemptionView,
  RewardRepository,
  UpdateRewardItemData,
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

  /** Catalogue management list — retired items included so they can be brought back. */
  listAll(): Promise<RewardItemRecord[]> {
    return this.rewards.listAllItems();
  }

  createItem(data: CreateRewardItemData): Promise<RewardItemRecord> {
    return this.rewards.createItem(data);
  }

  /** Edit price/stock/label, or retire the item with `active: false`. */
  async updateItem(id: string, data: UpdateRewardItemData): Promise<RewardItemRecord> {
    if (!(await this.rewards.findItem(id))) throw new RewardItemNotFoundError();
    return this.rewards.updateItem(id, data);
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
    depotId: string,
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
      depotId,
      pointsSpent: item.pointsCost,
      newBalance,
      reason: `Redeemed ${item.name}`,
      decrementStock: item.stock !== null,
    });
    return { redemption, pointsBalance: newBalance };
  }

  /** The customer's own redemption history — what their cancel button acts on. */
  listMine(customerId: string): Promise<RewardRedemptionView[]> {
    return this.rewards.listRedemptionsByCustomer(customerId);
  }

  /**
   * Staff hand-over queue: everything redeemed but not yet collected or cancelled.
   * Scoped to one depot when given — plus the legacy rows that never recorded one, which
   * any depot may serve because nobody knows where their owner will turn up.
   */
  listAwaitingHandover(depotId?: string): Promise<RewardRedemptionView[]> {
    return this.rewards.listRedemptionsByStatus('ACTIVE', depotId);
  }

  /**
   * M14-03: give the points back and put the reward back on the shelf.
   *
   * Only the owner may cancel, and only while the reward has not been collected — once
   * staff marked it USED the points bought something real. Cancelling twice is a
   * conflict rather than a silent second refund, which would mint points.
   */
  async cancel(customerId: string, redemptionId: string): Promise<RedeemResult> {
    const redemption = await this.rewards.findRedemption(redemptionId);
    // A redemption belonging to someone else is reported as missing, not forbidden —
    // otherwise the response confirms that an id exists.
    if (!redemption || redemption.customerId !== customerId) {
      throw new RewardRedemptionNotFoundError();
    }
    if (redemption.status === 'USED') throw new RewardAlreadyUsedError();
    if (redemption.status === 'CANCELLED') throw new RewardAlreadyCancelledError();

    const account = await this.loyalty.getAccount(customerId);
    const item = await this.rewards.findItem(redemption.rewardItemId);
    const newBalance = account.pointsBalance + redemption.pointsSpent;
    const cancelled = await this.rewards.cancel({
      redemptionId: redemption.id,
      accountId: account.id,
      customerId,
      rewardItemId: redemption.rewardItemId,
      pointsRefunded: redemption.pointsSpent,
      newBalance,
      reason: `Cancelled ${item?.name ?? 'reward'}`,
      // A deleted or unlimited-stock item has no counter to give back to.
      restoreStock: item != null && item.stock !== null,
    });
    return { redemption: cancelled, pointsBalance: newBalance };
  }

  /** Staff confirms the reward was handed over. Closes the cancellation window. */
  async markUsed(redemptionId: string): Promise<RewardRedemptionRecord> {
    const redemption = await this.rewards.findRedemption(redemptionId);
    if (!redemption) throw new RewardRedemptionNotFoundError();
    if (redemption.status === 'CANCELLED') throw new RewardAlreadyCancelledError();
    if (redemption.status === 'USED') return redemption; // idempotent
    return this.rewards.markUsed(redemption.id);
  }
}
