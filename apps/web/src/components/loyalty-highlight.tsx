'use client';

import { Trophy } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { Badge, Card, LinkButton } from '@/components/ui';
import type { LoyaltyAccount, TierBenefit } from '@/lib/types';

// Loyalty surface on Home. Signed-in: live points + tier + progress to the next
// tier. Guest: a teaser of the tier ladder with a sign-up CTA. Public tiers feed
// both; the live account is only fetched when authenticated.

export function LoyaltyHighlight() {
  const { customer } = useAuth();

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
    const next = sorted.find((t) => t.threshold > account.lifetimePoints);
    const pct = next
      ? Math.min(100, Math.round((account.lifetimePoints / next.threshold) * 100))
      : 100;
    return (
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Trophy size={20} weight="fill" className="text-brand-600" /> Poin & membership
          </h2>
          <Badge tone="brand">{account.tier}</Badge>
        </div>
        <p className="text-sm text-muted">
          <span className="text-2xl font-bold tabular-nums text-[color:var(--text)]">
            {account.pointsBalance.toLocaleString('id-ID')}
          </span>{' '}
          poin · diskon member {Math.round(account.discountRate * 100)}%
        </p>
        <div className="h-2 rounded-full bg-[color:var(--surface-muted)]">
          <div className="h-2 rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-muted">
          {next
            ? `${(next.threshold - account.lifetimePoints).toLocaleString('id-ID')} poin lagi menuju ${next.tier}.`
            : 'Anda sudah di tier tertinggi. Terima kasih!'}
        </p>
        <LinkButton href="/rewards" variant="secondary" className="self-start">
          Lihat rewards
        </LinkButton>
      </Card>
    );
  }

  // Guest teaser.
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Trophy size={20} weight="fill" className="text-brand-600" /> Kumpulkan poin tiap pesan
      </h2>
      <p className="text-sm text-muted">
        Jadi member dan dapatkan diskon makin besar seiring naik tier.
      </p>
      <div className="flex flex-wrap gap-2">
        {sorted.map((t) => (
          <span
            key={t.tier}
            className="rounded-lg border border-app px-3 py-1.5 text-sm font-semibold"
          >
            {t.tier} · {Math.round(t.discountRate * 100)}%
          </span>
        ))}
      </div>
      <LinkButton href="/register" className="self-start">
        Daftar gratis
      </LinkButton>
    </Card>
  );
}
