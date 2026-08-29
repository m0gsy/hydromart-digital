'use client';

import Link from 'next/link';
import { Trophy } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import { useLocation } from '@/lib/location-context';
import { Chip, LinkButton } from '@/components/ui';
import type { LoyaltyAccount, TierBenefit } from '@/lib/types';

// Loyalty surface on Home (left of the membership+depot row). Signed-in: live
// points + tier + progress to the next tier. Guest: a teaser of the tier ladder
// with a sign-up CTA. Public tiers feed both; the live account is only fetched
// when authenticated.

const CARD = 'surface flex flex-col gap-4 rounded-[22px] border border-app p-[26px]';

export function LoyaltyHighlight() {
  const { customer } = useAuth();
  const { location } = useLocation();
  const { t } = useT();

  // Both scoped to the shopper's location: the ladder is a per-depot setting, and a
  // teaser promising a rate the local depot does not give is worse than no teaser.
  const depotId = location?.depotId ?? null;
  const { data: tiers } = useAsync<TierBenefit[]>(
    () => api.getCached<TierBenefit[]>(endpoints.loyalty.tiers(depotId)),
    [depotId],
  );
  const { data: account } = useAsync<LoyaltyAccount>(
    () => (customer ? api.getCached(endpoints.loyalty.me(depotId), true) : Promise.resolve(null as never)),
    [customer, depotId],
  );

  if (!tiers || tiers.length === 0) return null;

  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  /*
   * W3. A tier whose rate is 0 has no discount to advertise, and this card was the only
   * place in the app that said so out loud anyway: products/detail, checkout and the
   * rewards hero each already drop their own row on `rate > 0`. Same per-row shape here.
   *
   * Measured 2026-08-27 against production `/loyalty/tiers`: SILVER, GOLD and PLATINUM
   * all return discountRate 0, so every guest on Beranda read "SILVER 0% GOLD 0%
   * PLATINUM 0%" — the first screen in the app, promising nothing three times.
   */
  const discounting = sorted.filter((tier) => tier.discountRate > 0);

  // Signed-in: show live balance + progress to the next tier threshold.
  if (customer && account) {
    const next = sorted.find((tier) => tier.threshold > account.lifetimePoints);
    const pct = next
      ? Math.min(100, Math.round((account.lifetimePoints / next.threshold) * 100))
      : 100;
    return (
      <div className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2.5 text-[17px] font-extrabold">
            <Trophy size={22} weight="fill" className="text-amber-600" /> {t('home.loyalty.membership')}
          </h2>
          <Chip tone="amber">{account.tier}</Chip>
        </div>
        <p>
          <span className="text-[32px] font-extrabold tabular-nums tracking-tight text-[color:var(--text)]">
            {account.pointsBalance.toLocaleString('id-ID')}
          </span>
          <span className="text-sm text-muted">
            {' '}
            {/* The unit alone when there is no rate — the number still needs the word. */}
            {account.discountRate > 0
              ? t('home.loyalty.balanceMeta', { n: Math.round(account.discountRate * 100) })
              : t('profile.rewards.points.unit')}
          </span>
        </p>
        <div className="h-2 rounded-full bg-[color:var(--surface-soft)]">
          <div className="h-2 rounded-full bg-amber-600" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-muted">
          {next ? (
            <>
              {t('home.loyalty.toNextPre', {
                points: (next.threshold - account.lifetimePoints).toLocaleString('id-ID'),
              })}
              <span className="font-extrabold text-[color:var(--text)]">{next.tier}</span>
              {/* "1.500 poin lagi menuju GOLD" is a whole sentence; the rise is the extra. */}
              {next.discountRate > 0 &&
                t('home.loyalty.toNextPost', { n: Math.round(next.discountRate * 100) })}
            </>
          ) : (
            t('home.loyalty.maxTier')
          )}
        </p>
        <Link
          href="/rewards"
          className="inline-flex self-start rounded-full border-[1.5px] border-[color:var(--text)] px-5 py-2.5 text-sm font-extrabold text-[color:var(--text)] transition-colors hover:bg-[color:var(--text)] hover:text-[color:var(--surface)]"
        >
          {t('home.loyalty.viewRewards')}
        </Link>
      </div>
    );
  }

  // Guest teaser — same card, amber accents + tier ladder + sign-up CTA.
  return (
    <div className={CARD}>
      <h2 className="flex items-center gap-2.5 text-[17px] font-extrabold">
        <Trophy size={22} weight="fill" className="text-amber-600" /> {t('home.loyalty.guestTitle')}
      </h2>
      {/*
        * The ladder above it is hidden when no tier discounts, and this sentence promised the
        * discounts anyway — "diskon makin besar seiring naik tier" over a card with no tiers
        * on it. All three rates are 0 in production today, so the first thing a guest reads
        * on Beranda was a claim the product does not honour. Driven by the same `discounting`
        * check, so the copy and the chips can never disagree again.
        */}
      <p className="text-sm text-muted">
        {t(discounting.length > 0 ? 'home.loyalty.guestBody' : 'home.loyalty.guestBodyPoints')}
      </p>
      {discounting.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {discounting.map((tier) => (
            <Chip key={tier.tier} tone="outline">
              {tier.tier} · {Math.round(tier.discountRate * 100)}%
            </Chip>
          ))}
        </div>
      )}
      <LinkButton href="/register" className="self-start">
        {t('home.loyalty.register')}
      </LinkButton>
    </div>
  );
}
