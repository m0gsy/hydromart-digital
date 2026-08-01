'use client';

// Member pricing. The teal "Member Rp X" chip on cards/PDP shows the price a
// member actually pays: basePrice × (1 − rate). Rates are the real loyalty tier
// discounts (server-owned) — never fabricated. Effective rate = the customer's
// own tier discount when signed in, otherwise the entry paid-tier rate as an
// honest teaser ("members save from N%"). Zero ⇒ hide the chip.
//
// Both thresholds and rates are per-depot settings, so the chip is quoted against the
// depot behind the shopper's chosen delivery location. Without a location it falls back
// to the global ladder — the same number as before this was tunable.

import { api } from './api';
import { endpoints } from './endpoints';
import { useAuth } from './auth-context';
import { useLocation } from './location-context';
import { useAsync } from './use-async';
import type { LoyaltyAccount, TierBenefit } from './types';

/** Pure rate selection — see test/member.test.ts. */
export function effectiveRate(
  account: LoyaltyAccount | null,
  tiers: TierBenefit[] | null,
): number {
  if (account && account.discountRate > 0) return account.discountRate;
  const entry = (tiers ?? [])
    .map((t) => t.discountRate)
    .filter((r) => r > 0)
    .sort((a, b) => a - b)[0];
  return entry ?? 0;
}

/** Member price for a base amount, rounded to whole rupiah. */
export function memberPrice(base: number, rate: number): number {
  return Math.round(base * (1 - rate));
}

/** The effective member discount rate for the current viewer (0 when none). */
export function useMemberRate(): number {
  const { customer } = useAuth();
  const { location } = useLocation();
  const depotId = location?.depotId ?? null;
  const { data: tiers } = useAsync<TierBenefit[]>(
    () => api.get<TierBenefit[]>(endpoints.loyalty.tiers(depotId)),
    [depotId],
  );
  const { data: account } = useAsync<LoyaltyAccount>(
    () => (customer ? api.get(endpoints.loyalty.me(depotId), true) : Promise.resolve(null as never)),
    [customer, depotId],
  );
  return effectiveRate(account, tiers);
}
