export interface RewardItemRecord {
  id: string;
  name: string;
  unit: string;
  pointsCost: number;
  imageUrl: string | null;
  active: boolean;
  /** Remaining redeemable stock; null = unlimited. */
  stock: number | null;
}

export interface RewardRedemptionRecord {
  id: string;
  rewardItemId: string;
  customerId: string;
  pointsSpent: number;
  createdAt: Date;
}

/** Atomic redemption: ledger entry + balance debit + (optional) stock decrement. */
export interface RedeemMutation {
  accountId: string;
  customerId: string;
  rewardItemId: string;
  idempotencyKey: string;
  pointsSpent: number;
  newBalance: number;
  reason: string;
  /** True when the item has finite stock and its counter must be decremented. */
  decrementStock: boolean;
}

export interface RewardRepository {
  listActiveItems(): Promise<RewardItemRecord[]>;
  findItem(id: string): Promise<RewardItemRecord | null>;
  /** Prior redemption for this idempotency key, used to make redeem idempotent. */
  findRedemptionByKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<RewardRedemptionRecord | null>;
  redeem(mutation: RedeemMutation): Promise<RewardRedemptionRecord>;
}
