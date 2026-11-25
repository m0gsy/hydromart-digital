/** One depot and the instants `[from, to)` a redemption handed over there may be counted in. */
export interface AiSpan {
  depotId: string;
  from: Date;
  to: Date;
}

export interface RedemptionTotals {
  redemptions: number;
  points: number;
  /** Distinct customers: one person who redeemed twice is one. */
  redeemers: number;
  /** Handed-over redemptions in the window whose depot was never recorded: in no depot's number. */
  unplaced: number;
}

export interface PointsOutstanding {
  /** Loyalty accounts that existed before the instant. */
  accounts: number;
  /** Sum of the whole ledger before the instant. */
  points: number;
}

/** HD-6 H4 part 2: the loyalty facts of O-02 and O-04. */
export interface AiLoyaltyRepository {
  /** Redemptions with status USED handed over (`usedAt`) inside one of the spans. */
  redemptions(spans: readonly AiSpan[]): Promise<RedemptionTotals>;
  /** The ledger and the accounts as they stood just before `before` (exclusive). */
  pointsOutstanding(before: Date): Promise<PointsOutstanding>;
}

export const AI_LOYALTY_REPOSITORY = Symbol('AiLoyaltyRepository');
