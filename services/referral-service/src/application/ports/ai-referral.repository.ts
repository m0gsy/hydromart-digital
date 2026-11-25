export interface ReferralTotals {
  /** Referrals made (a code redeemed) inside the window: one per referee, who can be referred once. */
  invited: number;
  /** Referrals that stand QUALIFIED now and qualified inside the window; a voided one was reopened and is not here. */
  qualified: number;
  /** Points of those qualified referrals, the referrer's side and the referee's side. */
  referrerPoints: number;
  refereePoints: number;
}

/** HD-6 H4 part 2: the referral facts of O-06. */
export interface AiReferralRepository {
  /** `[from, to)`. */
  totals(from: Date, to: Date): Promise<ReferralTotals>;
}

export const AI_REFERRAL_REPOSITORY = Symbol('AiReferralRepository');
