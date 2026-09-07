'use client';

import { api } from './api';
import { endpoints } from './endpoints';
import { useAsync } from './use-async';

export interface ReferralRules {
  /** Points the referrer gets when a referral qualifies (FR-092). */
  referrerPoints: number;
  /** Welcome points the referee gets on the same event. */
  refereePoints: number;
}

/**
 * The referral reward the screen is about to state in prose (CA-3-45).
 *
 * The same failure as `useLoyaltyRules`, one screen over: /referral promised the friend
 * "potongan di pesanan pertama" — a discount nothing in the codebase grants — and /rewards
 * promised "+50 poin" against a setting that has paid 500 for as long as it has existed.
 * Both are settings; a number typed into a dictionary is wrong the first time one moves.
 *
 * `getCached` for the same reason: reference data that changes when an operator edits a
 * setting, not while somebody reads a page.
 */
export function useReferralRules() {
  return useAsync<ReferralRules>(() => api.getCached(endpoints.referrals.rules), []);
}
