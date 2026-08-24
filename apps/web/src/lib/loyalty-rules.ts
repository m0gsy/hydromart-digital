'use client';

import { api } from './api';
import { endpoints } from './endpoints';
import { useAsync } from './use-async';

export interface LoyaltyRules {
  /** Rupiah of order subtotal that earns one point (BR-013). */
  earnRateRupiah: number;
  /** Months a point stays valid after it is earned (BR-014). */
  pointExpiryMonths: number;
}

/**
 * The earning rules the screen is about to state in prose.
 *
 * Three screens said "1 poin per Rp 1.000" as a literal — the customer rewards card, the
 * help FAQ, and the HQ loyalty page, which is the very screen an operator changes the rate
 * from. `earnRateRupiah` is a per-depot tunable: the first depot to change it had all
 * three quoting the old number back at its customers, with nothing anywhere to catch it.
 *
 * `getCached` because this is reference data in the exact sense that comment means: it
 * changes when an operator edits a setting, not while somebody reads a page.
 */
export function useLoyaltyRules(depotId?: string | null) {
  return useAsync<LoyaltyRules>(
    () => api.getCached(endpoints.loyalty.rules(depotId)),
    [depotId ?? ''],
  );
}
