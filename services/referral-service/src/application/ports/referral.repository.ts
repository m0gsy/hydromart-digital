import { ReferralStatus } from '../../domain/referral-status';

export interface ReferralCodeRecord {
  id: string;
  customerId: string;
  code: string;
  createdAt: Date;
}

export interface ReferralRecord {
  id: string;
  referrerCustomerId: string;
  refereeCustomerId: string;
  code: string;
  status: ReferralStatus;
  qualifyingOrderId: string | null;
  referrerPoints: number;
  refereePoints: number;
  qualifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields needed to create a new PENDING referral (referee redeeming a code). */
export interface CreateReferralData {
  referrerCustomerId: string;
  refereeCustomerId: string;
  code: string;
}

/** One row of a depot's top-referrer leaderboard (qualified referrals only). */
export interface TopReferrer {
  customerId: string;
  referralCount: number;
  pointsEarned: number;
}

export interface ReferralRepository {
  /** REF-03: PENDING referrals created before `before`, oldest first, at most `take`. */
  listStalePending(before: Date, take: number): Promise<ReferralRecord[]>;
  findCodeByCustomer(customerId: string): Promise<ReferralCodeRecord | null>;
  createCode(customerId: string, code: string): Promise<ReferralCodeRecord>;
  findCodeByCode(code: string): Promise<ReferralCodeRecord | null>;

  findReferralByReferee(refereeCustomerId: string): Promise<ReferralRecord | null>;
  createReferral(data: CreateReferralData): Promise<ReferralRecord>;

  listReferralsByReferrer(
    referrerCustomerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ReferralRecord[]; total: number }>;

  /** Counts for a referrer's summary: total referrals, qualified, and points earned. */
  summarizeReferrer(
    referrerCustomerId: string,
  ): Promise<{ referredCount: number; qualifiedCount: number; pointsEarned: number }>;

  /* ---- Depot-scoped aggregates: fan in over a list of referrers (a depot's customers).
     Empty list => zeros/[] without touching the DB (no `IN ()` query). ---- */

  /** All referrals whose referrer is in the list (any status). */
  countReferrals(referrerIds: string[]): Promise<number>;
  /** Referrals in the list that reached QUALIFIED. */
  countQualified(referrerIds: string[]): Promise<number>;
  /** Sum of referrerPoints over QUALIFIED referrals in the list. */
  sumReferrerPoints(referrerIds: string[]): Promise<number>;
  /** Top referrers in the list by qualified-referral count (desc), capped at `limit`. */
  topReferrers(referrerIds: string[], limit?: number): Promise<TopReferrer[]>;

  /** Freeze the first qualifying order and reward amounts while still PENDING. */
  prepareQualification(
    referralId: string,
    qualifyingOrderId: string,
    referrerPoints: number,
    refereePoints: number,
  ): Promise<ReferralRecord | null>;
  /** Mark a prepared referral QUALIFIED after both idempotent rewards land. */
  qualifyReferral(referralId: string, orderId: string): Promise<ReferralRecord | null>;
  markVoidedOrder(referralId: string, orderId: string): Promise<void>;
  /** Clear only the qualification belonging to the voided order, after rewards are reversed. */
  reopenAfterVoid(referralId: string, orderId: string): Promise<boolean>;
}
