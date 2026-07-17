'use client';

import { Coins, Crown, Gift, Lock, Medal, Sparkle } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { TierBenefit } from '@/lib/types';

// Static tier presentation (labels + local member counts). The real thresholds come from
// loyalty.tiers when available; member-per-tier splits have no endpoint yet.
// TODO: wire per-tier member counts + poin beredar/ditukar to a loyalty depot summary backend.
type TierCard = { label: string; range: string; members: string; icon: 'bronze' | 'silver' | 'gold' };
const FALLBACK_TIERS: TierCard[] = [
  { label: 'Perunggu', range: '0–999 poin', members: '612 anggota', icon: 'bronze' },
  { label: 'Perak', range: '1.000–4.999 poin', members: '198 anggota', icon: 'silver' },
  { label: 'Emas', range: '5.000+ poin', members: '74 anggota', icon: 'gold' },
];

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
  const { selected, depots } = useDepot();
  const depotName = (selected ?? depots[0])?.name ?? 'Semua depot';

  const members = useAsync<{ count: number }>(() => api.get(endpoints.loyalty.memberCount, true), []);
  const tiers = useAsync<TierBenefit[]>(() => api.get(endpoints.loyalty.tiers, true), []);

  // Build tier cards from real thresholds when present; else the static fallback.
  const ladder = [...(tiers.data ?? [])].sort((a, b) => a.threshold - b.threshold);
  const cards: TierCard[] =
    ladder.length >= 2
      ? ladder.map((tier, i) => {
          const next = ladder[i + 1];
          const range = next
            ? `${tier.threshold.toLocaleString('id-ID')}–${(next.threshold - 1).toLocaleString('id-ID')} poin`
            : `${tier.threshold.toLocaleString('id-ID')}+ poin`;
          return {
            label: tier.tier,
            range,
            members: FALLBACK_TIERS[i]?.members ?? '—',
            icon: i === ladder.length - 1 ? 'gold' : i === 0 ? 'bronze' : 'silver',
          };
        })
      : FALLBACK_TIERS;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkle size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Loyalty &amp; poin</h1>
            <p className="text-sm text-[color:var(--text-muted)]">{depotName} · program aktif</p>
          </div>
        </div>
        <Chip tone="outline">Atur aturan</Chip>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Anggota"
          value={
            members.loading ? '…' : members.error ? '—' : (members.data?.count ?? 0).toLocaleString('id-ID')
          }
        />
        {/* TODO: wire to loyalty depot summary backend */}
        <Stat label="Poin beredar" value="128.400" />
        <Stat label="Ditukar / bulan" value="41.200" />
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Coins size={18} weight="fill" className="text-brand-500" />
          Aturan perolehan
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex items-center justify-between gap-3 rounded-xl bg-[color:var(--surface-soft)] px-4 py-3">
            <span>Tiap galon 19L</span>
            <span className="font-bold text-brand-700">+10 poin</span>
          </li>
          <li className="flex items-center justify-between gap-3 rounded-xl bg-[color:var(--surface-soft)] px-4 py-3">
            <span>100 poin</span>
            <span className="font-bold text-brand-700">Rp5.000 potongan</span>
          </li>
        </ul>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Gift size={18} weight="fill" className="text-brand-500" />
          Tingkatan
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
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Loyalty &amp; poin hanya untuk Manajer depot.
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
