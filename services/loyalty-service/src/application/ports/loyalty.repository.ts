import { MembershipTier } from '../../domain/membership';
import { PointsTxnType } from '../../domain/points';

export interface LoyaltyAccountRecord {
  id: string;
  customerId: string;
  tier: MembershipTier;
  pointsBalance: number;
  lifetimePoints: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PointsTransactionRecord {
  id: string;
  customerId: string;
  type: PointsTxnType;
  points: number;
  orderId: string | null;
  reason: string | null;
  expiresAt: Date | null;
  expired: boolean;
  createdAt: Date;
}

/**
 * Atomic account mutation: insert a ledger entry and move the account totals together.
 *
 * H-2: the totals are DELTAS, applied by the database. They used to be absolutes computed
 * from a balance read outside the transaction, so of two concurrent writes the second
 * overwrote the first — points earned and then spent in the same second left the customer
 * with whichever total was written last.
 */
export interface AccountMutation {
  accountId: string;
  customerId: string;
  /** Signed change to the balance. A negative one is refused if the balance cannot cover it. */
  points: number;
  reason: string | null;
  /** Change to lifetimePoints — never negative, a spend does not un-earn a purchase. */
  lifetimeDelta: number;
}

export interface EarnMutation extends AccountMutation {
  orderId: string;
  expiresAt: Date;
}

export interface ExpiryMutation {
  lotId: string;
  accountId: string;
  customerId: string;
  /** Positive magnitude of the lot being expired (recorded as a negative EXPIRE entry). */
  points: number;
}

export interface LoyaltyRepository {
  findAccount(customerId: string): Promise<LoyaltyAccountRecord | null>;
  createAccount(customerId: string): Promise<LoyaltyAccountRecord>;

  /** Existing EARN entry for an order, used to make earning idempotent (BR-013). */
  findEarnByOrder(orderId: string): Promise<PointsTransactionRecord | null>;

  recordEarn(mutation: EarnMutation): Promise<LoyaltyAccountRecord>;
  recordAdjustment(
    mutation: AccountMutation & { type: PointsTxnType },
  ): Promise<LoyaltyAccountRecord>;
  /**
   * Stores the tier the account's authoritative lifetime total earns (H-2). Written after
   * the increment rather than alongside it, because only then is the lifetime the one the
   * database actually holds — computing it beforehand promotes off a stale read.
   */
  setTier(accountId: string, tier: MembershipTier): Promise<LoyaltyAccountRecord>;

  listTransactions(
    customerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: PointsTransactionRecord[]; total: number }>;

  /** EARN lots that are past their expiry and not yet swept (BR-014). */
  findExpirableLots(now: Date, limit: number): Promise<PointsTransactionRecord[]>;
  recordExpiry(mutation: ExpiryMutation): Promise<void>;

  /** Total enrolled loyalty accounts (HQ broadcast reach for the loyalty audience). */
  countAccounts(): Promise<number>;

  /* ---------- Depot-scoped aggregates (over a customerId list) ---------- */
  /** Members per tier for the given customers. Empty list → all zeros, no query. */
  countByTier(customerIds: string[]): Promise<Record<MembershipTier, number>>;
  /** Sum of current pointsBalance across the given customers. Empty list → 0, no query. */
  sumPointsBalance(customerIds: string[]): Promise<number>;
  /** Sum of RewardRedemption.pointsSpent for the given customers since `since`. Empty list → 0, no query. */
  sumRedeemedSince(customerIds: string[], since: Date): Promise<number>;
}

/** All-tiers-zero record, the empty/degraded result for countByTier. */
export function zeroTierCounts(): Record<MembershipTier, number> {
  return {
    [MembershipTier.REGULAR]: 0,
    [MembershipTier.SILVER]: 0,
    [MembershipTier.GOLD]: 0,
    [MembershipTier.PLATINUM]: 0,
  };
}
