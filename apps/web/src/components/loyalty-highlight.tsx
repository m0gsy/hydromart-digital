'use client';

import Link from 'next/link';
import { Trophy } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import { Chip, LinkButton } from '@/components/ui';
import type { LoyaltyAccount, TierBenefit } from '@/lib/types';

// Loyalty surface on Home (left of the membership+depot row). Signed-in: live
// points + tier + progress to the next tier. Guest: a teaser of the tier ladder
// with a sign-up CTA. Public tiers feed both; the live account is only fetched
// when authenticated.

const CARD = 'surface flex flex-col gap-4 rounded-[22px] border border-app p-[26px]';

export function LoyaltyHighlight() {
  const { customer } = useAuth();
  const { t } = useT();

  const { data: tiers } = useAsync<TierBenefit[]>(
    () => api.get<TierBenefit[]>(endpoints.loyalty.tiers),
    [],
  );
  const { data: account } = useAsync<LoyaltyAccount>(
    () => (customer ? api.get(endpoints.loyalty.me, true) : Promise.resolve(null as never)),
    [customer],
  );

  if (!tiers || tiers.length === 0) return null;

  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);

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
            {t('home.loyalty.balanceMeta', { n: Math.round(account.discountRate * 100) })}
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
              {t('home.loyalty.toNextPost', { n: Math.round(next.discountRate * 100) })}
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
      <p className="text-sm text-muted">{t('home.loyalty.guestBody')}</p>
      <div className="flex flex-wrap gap-2">
        {sorted.map((tier) => (
          <Chip key={tier.tier} tone="outline">
            {tier.tier} · {Math.round(tier.discountRate * 100)}%
          </Chip>
        ))}
      </div>
      <LinkButton href="/register" className="self-start">
        {t('home.loyalty.register')}
      </LinkButton>
    </div>
  );
}
