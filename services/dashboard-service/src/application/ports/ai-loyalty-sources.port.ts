/**
 * HD-6 H4 part 2: the loyalty, referral, promo-cost, subscription, campaign and open-queue facts the AI
 * read API reads, from loyalty-, referral-, order-, crm- and depot-service. Every method answers null when
 * its source cannot answer (down, unwired, non-2xx, a shape or number it does not recognise, a row for a
 * depot nobody asked): the metric then says belum_ada, never a partial sum or a 0.
 *
 * Reads that count PEOPLE are one call over spans (a depot and the instants it was readable): a distinct
 * count cannot be added up across calls. The network reads (points outstanding, referrals, new
 * subscriptions, campaigns) carry no depot at all: the metric only asks them for a role that reads the
 * whole network.
 */
/** Most spans and depots one many-depot read may carry; every internal route refuses more (422). */
export const MAX_SPANS = 200;
export const MAX_DEPOTS = 100;

export interface LoyaltySpan {
  depotId: string;
  /** ISO 8601 instants, `[from, to)`. */
  from: string;
  to: string;
}

export interface InstantWindow {
  from: string;
  to: string;
}

export interface RedemptionTotals {
  redemptions: number;
  points: number;
  /** Distinct customers. */
  redeemers: number;
  /** Handed-over redemptions in the window whose depot was never recorded. */
  unplaced: number;
}

export interface PointsOutstandingTotals {
  accounts: number;
  points: number;
}

export interface ReferralTotals {
  invited: number;
  qualified: number;
  /** Distinct referrers behind the qualified referrals; invited and qualified already count distinct referees. */
  qualifiedReferrers: number;
  referrerPoints: number;
  refereePoints: number;
}

export interface DiscountTotals {
  orders: number;
  discountedOrders: number;
  discountIdr: number;
}

export interface NewSubscriptionTotals {
  subscriptions: number;
  subscribers: number;
}

export interface CampaignTotals {
  campaigns: number;
  sent: number;
  failed: number;
  skipped: number;
  other: number;
}

export interface OpenQueueRow {
  depotId: string;
  incidents: number;
  disputes: number;
  approvals: number;
  maintenanceOverdue: number;
}

export interface AiLoyaltySourcesPort {
  /** At most 200 spans over at most 100 depots: one call. */
  redemptions(spans: readonly LoyaltySpan[]): Promise<RedemptionTotals | null>;
  /** The ledger and the accounts before the instant (exclusive). */
  pointsOutstanding(before: string): Promise<PointsOutstandingTotals | null>;
  referrals(window: InstantWindow): Promise<ReferralTotals | null>;
  /** At most 200 spans over at most 100 depots: one call. */
  discounts(spans: readonly LoyaltySpan[]): Promise<DiscountTotals | null>;
  newSubscriptions(window: InstantWindow): Promise<NewSubscriptionTotals | null>;
  campaigns(window: InstantWindow): Promise<CampaignTotals | null>;
  /** At most 100 depots per call; one row for each depot asked, or null. */
  openQueues(depotIds: readonly string[]): Promise<OpenQueueRow[] | null>;
}
