'use client';

import { Crown, Gift } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useLoyaltyRules } from '@/lib/loyalty-rules';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { RewardItem, TierBenefit } from '@/lib/types';

// Design 18b — loyalty program. Real: loyalty.tiers + rewards.catalog + loyalty.rules.
//
// The earn rate was written here as "Rp 1.000", described in this comment as "a fixed
// program constant". It is not one: `earnRateRupiah` is a per-depot setting, and this is
// the HQ screen an operator reads before going to Pengaturan to change it. It now reads
// the value, network-wide, from the same accessor the earning arithmetic uses.
export default function HqLoyaltyPage() {
  const { t } = useT();
  // No depot arg: HQ looks at the network-wide ladder. Per-depot overrides are edited
  // in Pengaturan, scoped to their depot.
  const tiers = useAsync<TierBenefit[]>(() => api.get(endpoints.loyalty.tiers()));
  const rewards = useAsync<RewardItem[]>(() => api.get(endpoints.rewards.catalog));
  // No depot arg, same as `tiers`: HQ states the network-wide rule.
  const rules = useLoyaltyRules();

  const ladder = [...(tiers.data ?? [])].sort((a, b) => a.threshold - b.threshold);

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Crown} title={t('hq.loyalty.title')} subtitle={t('hq.loyalty.subtitle')} />

      {/* Tiers — REAL */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">{t('hq.loyalty.tiers')}</h2>
        {/* No rate read, no sentence: a note that invents a number is worse than no note. */}
        {rules.data && (
          <p className="text-xs text-muted">
            {t('hq.loyalty.earnNote', { amount: formatIDR(rules.data.earnRateRupiah) })}
          </p>
        )}
        {tiers.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : tiers.error ? (
          <ErrorState message={tiers.error} onRetry={tiers.reload} />
        ) : ladder.length === 0 ? (
          <p className="py-2 text-sm text-muted">{t('hq.loyalty.tiersEmpty')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ladder.map((tier) => (
              <div key={tier.tier} className="flex flex-col gap-1 rounded-xl border border-app p-4">
                <span className="text-sm font-bold">{tier.tier}</span>
                <span className="text-xs text-muted">
                  {t('hq.loyalty.threshold')}: {tier.threshold.toLocaleString('id-ID')}
                </span>
                <span className="mt-1 text-lg font-bold tabular-nums text-brand-700">
                  {Math.round(tier.discountRate * 100)}%
                </span>
                <span className="text-xs text-muted">{t('hq.loyalty.discount')}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Rewards — REAL */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Gift size={18} weight="fill" className="text-brand-500" />
          {t('hq.loyalty.rewards')}
        </h2>
        {rewards.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : rewards.error ? (
          <ErrorState message={rewards.error} onRetry={rewards.reload} />
        ) : !rewards.data || rewards.data.length === 0 ? (
          <p className="py-2 text-sm text-muted">{t('hq.loyalty.rewardsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {rewards.data.map((r) => {
              const out = r.stock !== null && r.stock <= 0;
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{r.name}</span>
                    <span className="ml-1 text-xs text-muted">/ {r.unit}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {out && (
                      <span className="rounded-full bg-[color:var(--surface-soft)] px-2.5 py-0.5 text-xs font-bold text-muted">
                        {t('hq.loyalty.soldOut')}
                      </span>
                    )}
                    <span className="font-bold tabular-nums text-brand-700">
                      {t('hq.loyalty.points', { n: r.pointsCost.toLocaleString('id-ID') })}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
