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

export interface ReferralRepository {
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

  /**
   * Atomically flip a referral PENDING -> QUALIFIED (only if currently PENDING), setting
   * qualifiedAt=now, the qualifying order, and the awarded points. Returns the updated
   * record, or null if it was not PENDING (already qualified / lost race).
   */
  qualifyReferral(
    referralId: string,
    qualifyingOrderId: string,
    referrerPoints: number,
    refereePoints: number,
  ): Promise<ReferralRecord | null>;
}
