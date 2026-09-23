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
  /** LOY-2: the staff account behind a manual correction. Null for system entries. */
  createdBy?: string | null;
}

/** LOY-6/LOY-7: undoing exactly what one order awarded, once. */
export interface ReversalMutation {
  accountId: string;
  customerId: string;
  /** The reversed order. Keys the row, so a retried void is a no-op, not a second debit. */
  orderId: string;
  /** Positive magnitude of the EARN being taken back. */
  points: number;
  reason: string | null;
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
   * LOY-6/LOY-7: take back an order's points once — balance floored at zero (points
   * already spent are a debt the sale created, not a reason to refuse) and lifetime given
   * back with them, so a voided sale stops counting towards a tier. Idempotent on the
   * order: a repeat returns the account untouched.
   */
  recordReversal(mutation: ReversalMutation): Promise<LoyaltyAccountRecord>;
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
  /**
   * LOY-8: expire one lot. Returns false when another sweep had already claimed it — the
   * claim is conditional, so two overlapping runs cannot both debit the same lot.
   */
  recordExpiry(mutation: ExpiryMutation): Promise<boolean>;
  /** LOY-8: close a lot with nothing left to take (its points were already spent). */
  markLotExpired(lotId: string): Promise<void>;

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
