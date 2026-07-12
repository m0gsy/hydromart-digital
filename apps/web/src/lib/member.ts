'use client';

// Member pricing. The teal "Member Rp X" chip on cards/PDP shows the price a
// member actually pays: basePrice × (1 − rate). Rates are the real loyalty tier
// discounts (server-owned) — never fabricated. Effective rate = the customer's
// own tier discount when signed in, otherwise the entry paid-tier rate as an
// honest teaser ("members save from N%"). Zero ⇒ hide the chip.

import { api } from './api';
import { endpoints } from './endpoints';
import { useAuth } from './auth-context';
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
  const { data: tiers } = useAsync<TierBenefit[]>(
    () => api.get<TierBenefit[]>(endpoints.loyalty.tiers),
    [],
  );
  const { data: account } = useAsync<LoyaltyAccount>(
    () => (customer ? api.get(endpoints.loyalty.me, true) : Promise.resolve(null as never)),
    [customer],
  );
  return effectiveRate(account, tiers);
}
