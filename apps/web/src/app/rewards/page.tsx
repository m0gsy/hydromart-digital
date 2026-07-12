'use client';

import { useState } from 'react';
import {
  CaretDown,
  CheckCircle,
  Copy,
  Crown,
  Gift,
  Sparkle,
  Trophy,
} from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, Chip, ErrorState, Field, Input, SectionHeader, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { tierProgress } from '@/lib/loyalty';
import { useAsync } from '@/lib/use-async';
import type {
  LoyaltyAccount,
  MembershipTier,
  Page,
  PointsTransaction,
  PointsTxnType,
  ReferralSummary,
  TierBenefit,
} from '@/lib/types';

// Per-tier visual identity for the hero + perks ladder. SILVER/REGULAR read as
// muted ink, GOLD as amber, PLATINUM as teal brand — a crown marks the two top
// tiers, a trophy the rest.
type TierAccent = {
  icon: typeof Trophy;
  chip: 'outline' | 'amber' | 'tint';
  tint: string; // hero + current-perk background wash
  icon_color: string;
  bar: string; // progress-bar fill
};

const TIER_ACCENT: Record<MembershipTier, TierAccent> = {
  REGULAR: {
    icon: Trophy,
    chip: 'outline',
    tint: 'bg-[color:var(--surface-soft)]',
    icon_color: 'text-[color:var(--text)]',
    bar: 'bg-[color:var(--text)]',
  },
  SILVER: {
    icon: Trophy,
    chip: 'outline',
    tint: 'bg-[color:var(--surface-soft)]',
    icon_color: 'text-[color:var(--text)]',
    bar: 'bg-[color:var(--text)]',
  },
  GOLD: {
    icon: Crown,
    chip: 'amber',
    tint: 'bg-[color:var(--warning-bg)]',
    icon_color: 'text-[color:var(--warning)]',
    bar: 'bg-[color:var(--warning)]',
  },
  PLATINUM: {
    icon: Crown,
    chip: 'tint',
    tint: 'bg-brand-50',
    icon_color: 'text-brand-700',
    bar: 'bg-brand-600',
  },
};

const TXN_LABEL: Record<PointsTxnType, string> = {
  EARN: 'Poin masuk',
  REWARD: 'Tukar reward',
  ADJUST: 'Penyesuaian',
  EXPIRE: 'Poin hangus',
};

/** Hero (aspirational tier card) + perks ladder — one account + tiers fetch feeds both. */
function LoyaltySection() {
  const account = useAsync<LoyaltyAccount>(() => api.get(endpoints.loyalty.me, true));
  const tiers = useAsync<TierBenefit[]>(() => api.get(endpoints.loyalty.tiers));

  if (account.loading || tiers.loading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (account.error) return <ErrorState message={account.error} onRetry={account.reload} />;
  if (!account.data) return null;

  const acc = account.data;
  const ladder = [...(tiers.data ?? [])].sort((a, b) => a.threshold - b.threshold);
  const progress = tierProgress(ladder, acc.lifetimePoints);
  const accent = TIER_ACCENT[acc.tier] ?? TIER_ACCENT.REGULAR;
  const HeroIcon = accent.icon;

  return (
    <div className="flex flex-col gap-8">
      {/* --- Tier hero --- */}
      <Card className="overflow-hidden p-0">
        <div className={`flex flex-col gap-6 p-6 sm:p-8 ${accent.tint}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5 text-sm font-bold text-muted">
              <span className="surface flex h-10 w-10 items-center justify-center rounded-full shadow-card">
                <HeroIcon size={22} weight="fill" className={accent.icon_color} />
              </span>
              Keanggotaan
            </span>
            <Chip tone={accent.chip}>{acc.tier}</Chip>
          </div>

          <div>
            <p className="text-[40px] font-extrabold leading-none tabular-nums tracking-tight text-[color:var(--text)] sm:text-5xl">
              {acc.pointsBalance.toLocaleString('id-ID')}
            </p>
            <p className="mt-2 text-sm text-muted">
              {acc.lifetimePoints.toLocaleString('id-ID')} poin seumur hidup
              {acc.discountRate > 0 && (
                <>
                  {' · '}
                  diskon member{' '}
                  <span className="font-bold text-[color:var(--text)]">
                    {Math.round(acc.discountRate * 100)}%
                  </span>
                </>
              )}
            </p>
          </div>

          {progress.next ? (
            <div className="flex flex-col gap-2">
              <div className="h-2.5 overflow-hidden rounded-full bg-[color:var(--surface)]">
                <div
                  className={`h-full rounded-full transition-[width] ${accent.bar}`}
                  style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                />
              </div>
              <p className="text-sm text-muted">
                {progress.pointsToNext.toLocaleString('id-ID')} poin lagi menuju{' '}
                <span className="font-extrabold text-[color:var(--text)]">{progress.next.tier}</span>
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-sm font-bold text-brand-700">
              <Crown size={18} weight="fill" /> Anda di tier tertinggi. Terima kasih!
            </p>
          )}
        </div>
      </Card>

      {/* --- Perks ladder --- */}
      {ladder.length > 0 && (
        <section>
          <SectionHeader title="Keuntungan tiap tier" subtitle="Naik tier, diskon makin besar." />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ladder.map((t) => {
              const isCurrent = t.tier === acc.tier;
              const a = TIER_ACCENT[t.tier] ?? TIER_ACCENT.REGULAR;
              const PerkIcon = a.icon;
              return (
                <div
                  key={t.tier}
                  className={`flex flex-col gap-2 rounded-2xl border-2 p-4 transition-colors ${
                    isCurrent ? 'border-brand-600 bg-brand-50' : 'border-app surface'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <PerkIcon size={20} weight="fill" className={a.icon_color} />
                    {isCurrent && <Chip tone="tint">Tier Anda</Chip>}
                  </div>
                  <p className="text-sm font-extrabold tracking-tight text-[color:var(--text)]">
                    {t.tier}
                  </p>
                  <p className="text-2xl font-extrabold tabular-nums tracking-tight text-[color:var(--text)]">
                    Diskon {Math.round(t.discountRate * 100)}%
                  </p>
                  <p className="text-xs text-muted">
                    tiap checkout · mulai {t.threshold.toLocaleString('id-ID')} poin
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** Points ledger — demoted behind a collapse toggle so the hero leads. */
function LedgerCard() {
  const { data, error, loading, reload } = useAsync<Page<PointsTransaction>>(() =>
    api.get(endpoints.loyalty.transactions({ limit: 10 }), true),
  );
  const [open, setOpen] = useState(false);

  if (loading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const items = data?.items ?? [];
  return (
    <Card className="flex flex-col p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center justify-between gap-2 rounded-lg text-left font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {open ? 'Sembunyikan aktivitas poin' : 'Lihat aktivitas poin'}
        <CaretDown
          size={18}
          weight="bold"
          className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        (items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Belum ada aktivitas. Selesaikan pesanan untuk mulai mengumpulkan poin.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[color:var(--border)]">
            {items.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>
                  <span className="block font-semibold">{TXN_LABEL[t.type]}</span>
                  <span className="block text-xs text-muted">{formatDateTime(t.createdAt)}</span>
                </span>
                <span
                  className={`font-extrabold tabular-nums ${
                    t.points < 0 ? 'text-[color:var(--danger)]' : 'text-[color:var(--success)]'
                  }`}
                >
                  {t.points > 0 ? '+' : ''}
                  {t.points.toLocaleString('id-ID')}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  );
}

/** Referral card — code chip + Copy, stat trio, and a redeem form. */
function ReferralCard() {
  const { data, error, loading, reload } = useAsync<ReferralSummary>(() =>
    api.get(endpoints.referrals.me, true),
  );
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState(false);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the code is visible on screen to copy manually */
    }
  }

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    setRedeeming(true);
    setRedeemError(null);
    try {
      await api.post(endpoints.referrals.redeem, { code: code.trim() }, true);
      setRedeemed(true);
      setCode('');
    } catch (err) {
      setRedeemError(err instanceof ApiError ? err.message : 'Kode tidak dapat digunakan.');
    } finally {
      setRedeeming(false);
    }
  }

  if (loading) return <Skeleton className="h-52 w-full rounded-2xl" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const stats: { label: string; value: string }[] = [
    { label: 'Diajak', value: data.referredCount.toLocaleString('id-ID') },
    { label: 'Memenuhi', value: data.qualifiedCount.toLocaleString('id-ID') },
    { label: 'Poin', value: data.pointsEarned.toLocaleString('id-ID') },
  ];

  return (
    <Card className="flex flex-col gap-5 p-5">
      <span className="flex items-center gap-2 font-bold">
        <Gift size={20} weight="fill" className="text-brand-600" />
        Ajak teman
      </span>

      <div>
        <p className="mb-1.5 text-sm text-muted">Kode referral Anda</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 px-4 py-3 text-center text-lg font-extrabold tracking-[0.2em] text-brand-800">
            {data.code.code}
          </code>
          <Button variant="secondary" onClick={copy} type="button" aria-label="Salin kode">
            {copied ? <CheckCircle size={18} weight="fill" /> : <Copy size={18} weight="bold" />}
            {copied ? 'Tersalin' : 'Salin'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Teman memasukkan kode ini, dan kalian berdua dapat poin saat pesanan pertamanya selesai.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-brand-50 p-3">
            <p className="text-xl font-extrabold tabular-nums text-brand-800">{s.value}</p>
            <p className="text-xs text-muted">{s.label}</p>
          </div>
        ))}
      </div>

      <form onSubmit={redeem} className="flex flex-col gap-2 border-t border-app pt-4">
        <Field label="Punya kode teman?" htmlFor="referralCode">
          <div className="flex items-center gap-2">
            <Input
              id="referralCode"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="A1B2C3D4"
              autoCapitalize="characters"
              disabled={redeemed}
            />
            <Button type="submit" loading={redeeming} disabled={!code.trim() || redeemed}>
              Pakai
            </Button>
          </div>
        </Field>
        {redeemed && (
          <p
            className="flex items-center gap-1.5 text-sm font-semibold text-[color:var(--success)]"
            role="status"
          >
            <CheckCircle size={16} weight="fill" />
            Kode dipakai — poin masuk saat pesanan pertama Anda selesai.
          </p>
        )}
        {redeemError && (
          <p className="text-sm font-semibold text-[color:var(--danger)]" role="alert">
            {redeemError}
          </p>
        )}
      </form>
    </Card>
  );
}

function RewardsInner() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="flex items-center gap-2.5 text-[30px] font-extrabold tracking-tight">
        <Sparkle size={28} weight="fill" className="text-brand-600" />
        Rewards &amp; poin
      </h1>

      <LoyaltySection />

      <div className="grid gap-5 md:grid-cols-2">
        <LedgerCard />
        <ReferralCard />
      </div>
    </div>
  );
}

export default function RewardsPage() {
  return (
    <RequireAuth>
      <RewardsInner />
    </RequireAuth>
  );
}
