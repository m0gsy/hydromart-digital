'use client';

import { Coins, Crown, Gift, Lock, Medal, Sparkle } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotLoyaltySummary, TierBenefit } from '@/lib/types';

// Tier thresholds come from loyalty.tiers (network-wide, real); per-tier member counts +
// points-outstanding + redeemed-this-month come from the depot-scoped summary (this depot's
// own customers only).
type TierCard = {
  label: string;
  range: string;
  members: string;
  icon: 'bronze' | 'silver' | 'gold';
};

function tierIcon(kind: TierCard['icon']) {
  if (kind === 'gold') return <Crown size={22} weight="fill" className="text-brand-600" />;
  return (
    <Medal size={22} weight="fill" className={kind === 'silver' ? 'text-[color:var(--text-muted)]' : 'text-amber-700'} />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-[color:var(--text-muted)]">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
    </Card>
  );
}

function LoyaltyBody() {
  const { t } = useT();
  const { scopedId, selected, depots } = useDepot();
  const depotName = (selected ?? depots.find((d) => d.id === scopedId) ?? depots[0])?.name ?? t('dashB.loyalty.depotFallback');

  const summary = useAsync<DepotLoyaltySummary | null>(
    () => (scopedId ? api.get(endpoints.loyalty.depotSummary(scopedId), true) : Promise.resolve(null)),
    [scopedId],
  );
  const tiers = useAsync<TierBenefit[]>(() => api.get(endpoints.loyalty.tiers, true), []);

  const s = summary.data;
  const idr = (n: number | undefined) => (n ?? 0).toLocaleString('id-ID');

  // Tier cards: real thresholds (loyalty.tiers) + this depot's member count per tier (summary).
  const ladder = [...(tiers.data ?? [])].sort((a, b) => a.threshold - b.threshold);
  const cards: TierCard[] = ladder.map((tier, i) => {
    const next = ladder[i + 1];
    const range = next
      ? t('dashB.loyalty.rangeMid', {
          from: tier.threshold.toLocaleString('id-ID'),
          to: (next.threshold - 1).toLocaleString('id-ID'),
        })
      : t('dashB.loyalty.rangeTop', { from: tier.threshold.toLocaleString('id-ID') });
    const count = s?.tiers?.[tier.tier as keyof DepotLoyaltySummary['tiers']];
    return {
      label: tier.tier,
      range,
      members: count != null ? t('dashB.loyalty.memberCount', { n: count.toLocaleString('id-ID') }) : '—',
      icon: i === ladder.length - 1 ? 'gold' : i === 0 ? 'bronze' : 'silver',
    };
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkle size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('dashB.loyalty.title')}</h1>
            <p className="text-sm text-[color:var(--text-muted)]">{depotName} · {t('dashB.loyalty.programActive')}</p>
          </div>
        </div>
        <Chip tone="outline">{t('dashB.loyalty.manageRules')}</Chip>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('dashB.loyalty.members')} value={summary.loading ? '…' : idr(s?.totalMembers)} />
        <Stat label={t('dashB.loyalty.pointsOutstanding')} value={summary.loading ? '…' : idr(s?.pointsOutstanding)} />
        <Stat label={t('dashB.loyalty.redeemedMonth')} value={summary.loading ? '…' : idr(s?.redeemedThisMonth)} />
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Coins size={18} weight="fill" className="text-brand-500" />
          {t('dashB.loyalty.earningRules')}
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex items-center justify-between gap-3 rounded-xl bg-[color:var(--surface-soft)] px-4 py-3">
            <span>{t('dashB.loyalty.perGallon')}</span>
            <span className="font-bold text-brand-700">{t('dashB.loyalty.perGallonPoints')}</span>
          </li>
          <li className="flex items-center justify-between gap-3 rounded-xl bg-[color:var(--surface-soft)] px-4 py-3">
            <span>{t('dashB.loyalty.hundredPoints')}</span>
            <span className="font-bold text-brand-700">{t('dashB.loyalty.hundredPointsValue')}</span>
          </li>
        </ul>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Gift size={18} weight="fill" className="text-brand-500" />
          {t('dashB.loyalty.tiers')}
        </h2>
        {tiers.loading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {cards.map((c) => (
              <Card
                key={c.label}
                className={`flex flex-col gap-2 p-4 ${c.icon === 'gold' ? 'border-2 border-brand-500' : ''}`}
              >
                <div className="flex items-center gap-2">
                  {tierIcon(c.icon)}
                  <span className="font-semibold">{c.label}</span>
                </div>
                <span className="text-xs text-[color:var(--text-muted)]">{c.range}</span>
                <span className="text-sm font-semibold tabular-nums">{c.members}</span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title={t('dashB.loyalty.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.loyalty.gateBody')}
      </CenterState>
    );
  }
  return <LoyaltyBody />;
}

export default function LoyaltyPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
