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

/** M14-03 redemption lifecycle. Mirrors the TEXT column; no Prisma enum to migrate. */
export type RedemptionStatus = 'ACTIVE' | 'USED' | 'CANCELLED';

export interface RewardRedemptionRecord {
  id: string;
  rewardItemId: string;
  customerId: string;
  pointsSpent: number;
  status: RedemptionStatus;
  /**
   * Depot the customer chose to collect from. Null only on rows created before the
   * question existed — never a guess. See listRedemptionsByStatus for how they surface.
   */
  depotId: string | null;
  usedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

/**
 * A redemption plus the item's label. Lists render the reward name, and the customer
 * may have redeemed an item that was retired since — so the name is joined at read
 * time rather than looked up per row by the caller.
 */
export interface RewardRedemptionView extends RewardRedemptionRecord {
  rewardName: string;
}

/** Atomic cancellation: mark CANCELLED + credit the points back + restore stock. */
export interface CancelRedemptionMutation {
  redemptionId: string;
  accountId: string;
  customerId: string;
  rewardItemId: string;
  pointsRefunded: number;
  reason: string;
  /** True when the item has finite stock and its counter must be given back. */
  restoreStock: boolean;
}

/** Atomic redemption: ledger entry + balance debit + (optional) stock decrement. */
export interface RedeemMutation {
  accountId: string;
  customerId: string;
  rewardItemId: string;
  idempotencyKey: string;
  /** Where the customer said they will collect it. */
  depotId: string;
  pointsSpent: number;
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
  findRedemption(id: string): Promise<RewardRedemptionRecord | null>;
  /** The customer's own redemptions, newest first — the list their cancel button sits on. */
  listRedemptionsByCustomer(customerId: string): Promise<RewardRedemptionView[]>;
  /**
   * The staff hand-over queue in one state, oldest first.
   *
   * With a `depotId` the queue is that depot's, PLUS every legacy row that has no depot
   * recorded: those predate the question, and hiding them would strand a customer whose
   * reward no depot can see. Without one (head office) it is the whole network.
   */
  listRedemptionsByStatus(
    status: RedemptionStatus,
    depotId?: string,
  ): Promise<RewardRedemptionView[]>;
  /** Staff marks the reward physically handed over — after this it cannot be cancelled. */
  markUsed(id: string): Promise<RewardRedemptionRecord>;
  cancel(mutation: CancelRedemptionMutation): Promise<RewardRedemptionRecord>;
}
