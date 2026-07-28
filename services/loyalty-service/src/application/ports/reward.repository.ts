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

export interface CreateRewardItemData {
  name: string;
  unit: string;
  pointsCost: number;
  imageUrl: string | null;
  /** Finite remaining stock, or null for unlimited. */
  stock: number | null;
  active: boolean;
}

export type UpdateRewardItemData = Partial<CreateRewardItemData>;

export interface RewardRepository {
  listActiveItems(): Promise<RewardItemRecord[]>;
  /** Catalogue management view — includes retired items the customer catalogue hides. */
  listAllItems(): Promise<RewardItemRecord[]>;
  findItem(id: string): Promise<RewardItemRecord | null>;
  createItem(data: CreateRewardItemData): Promise<RewardItemRecord>;
  updateItem(id: string, data: UpdateRewardItemData): Promise<RewardItemRecord>;
  /** Prior redemption for this idempotency key, used to make redeem idempotent. */
  findRedemptionByKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<RewardRedemptionRecord | null>;
  redeem(mutation: RedeemMutation): Promise<RewardRedemptionRecord>;
}
