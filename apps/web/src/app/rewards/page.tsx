'use client';

import { useRef, useState } from 'react';
import {
  ArrowRight,
  CaretDown,
  CheckCircle,
  Coin,
  Copy,
  Crown,
  Gift,
  ShoppingBag,
  Sparkle,
  Ticket,
  Trophy,
  Truck,
  WarningCircle,
} from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, Chip, ErrorState, Field, Input, SectionHeader, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime, formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { tierProgress } from '@/lib/loyalty';
import { useAsync } from '@/lib/use-async';
import type {
  LoyaltyAccount,
  MyVoucher,
  Page,
  PointsTransaction,
  ReferralSummary,
  RewardItem,
  RewardRedemption,
  TierBenefit,
  VoucherStatus,
} from '@/lib/types';

const idr = (n: number) => n.toLocaleString('id-ID');

/* ============================ Hero (membership + points) ============================ */

function Hero({
  account,
  tiers,
  onRedeemClick,
}: {
  account: LoyaltyAccount;
  tiers: TierBenefit[];
  onRedeemClick: () => void;
}) {
  const { t } = useT();
  const ladder = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const progress = tierProgress(ladder, account.lifetimePoints);
  const rupiahValue = Math.round(account.pointsBalance * 10); // 1 poin ≈ Rp 10 potongan

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* membership progress — deep-teal gradient */}
      <div className="relative overflow-hidden rounded-3xl p-6 text-white sm:p-8" style={{ background: 'linear-gradient(120deg,#0b4d57,#0c97ac)' }}>
        <div className="flex items-center gap-2.5 text-xs font-extrabold uppercase tracking-wide text-white/75">
          <Trophy size={17} weight="fill" className="text-[#8fe3ee]" />
          {t('profile.rewards.hero.membership')}
        </div>
        <div className="mt-3 flex items-end gap-3">
          <span className="text-4xl font-extrabold tracking-tight">{account.tier}</span>
          {account.discountRate > 0 && (
            <span className="mb-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-extrabold">
              {t('profile.rewards.hero.tierDiscount', { pct: Math.round(account.discountRate * 100) })}
            </span>
          )}
        </div>
        {progress.next ? (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-white/80">
                {t('profile.rewards.hero.toNextShort')} <strong className="text-white">{progress.next.tier}</strong>
              </span>
              <span className="font-extrabold tabular-nums">
                {idr(account.lifetimePoints)} / {idr(progress.next.threshold)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-[#8fe3ee]" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-white/70">
              {t('profile.rewards.hero.toNext', { n: idr(progress.pointsToNext) })}{' '}
              <strong className="text-white">{progress.next.tier}</strong>.
            </p>
          </div>
        ) : (
          <p className="mt-6 flex items-center gap-1.5 text-sm font-bold text-[#8fe3ee]">
            <Crown size={18} weight="fill" /> {t('profile.rewards.hero.topTier')}
          </p>
        )}
      </div>

      {/* points balance — ink card + Tukar CTA */}
      <div className="flex flex-col justify-center gap-1.5 rounded-3xl bg-[color:var(--text)] p-6 text-[color:var(--surface)] sm:p-7">
        <div className="text-sm font-bold text-[color:var(--surface)]/60">{t('profile.rewards.points.label')}</div>
        <div className="flex items-baseline gap-2">
          <span className="text-[44px] font-extrabold leading-none tracking-tight tabular-nums">{idr(account.pointsBalance)}</span>
          <span className="text-sm font-bold text-brand-300">{t('profile.rewards.points.unit')}</span>
        </div>
        <div className="text-sm text-[color:var(--surface)]/60">
          {t('profile.rewards.points.worth', { amount: formatIDR(rupiahValue) })}
        </div>
        <button
          type="button"
          onClick={onRedeemClick}
          className="mt-3 flex h-12 items-center justify-center gap-2 rounded-full bg-brand-300 text-sm font-extrabold text-[color:var(--text)] transition-colors hover:bg-brand-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
        >
          {t('profile.rewards.points.redeemCta')}
          <ArrowRight size={15} weight="bold" />
        </button>
      </div>
    </div>
  );
}

/* ============================ Voucher wallet ============================ */

const VOUCHER_STATUS_TONE: Record<VoucherStatus, { chip: 'tint' | 'amber' | 'outline'; muted: boolean }> = {
  AVAILABLE: { chip: 'tint', muted: false },
  USED: { chip: 'outline', muted: true },
  EXPIRED: { chip: 'outline', muted: true },
  UPCOMING: { chip: 'amber', muted: false },
  SOLD_OUT: { chip: 'outline', muted: true },
};

function VoucherWallet({ onHistory }: { onHistory: () => void }) {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<MyVoucher[]>(() => api.get(endpoints.vouchers.me, true));

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-extrabold tracking-tight">{t('profile.rewards.wallet.title')}</h2>
        <button type="button" onClick={onHistory} className="text-sm font-bold text-brand-700 hover:underline">
          {t('profile.rewards.wallet.history')} →
        </button>
      </div>
      {loading ? (
        <Skeleton className="h-28 w-full rounded-2xl" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">{t('profile.rewards.wallet.empty')}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((v) => {
            const tone = VOUCHER_STATUS_TONE[v.status];
            const discount =
              v.discountType === 'PERCENTAGE'
                ? t('profile.rewards.wallet.pct', { pct: v.value })
                : formatIDR(v.value);
            return (
              <div
                key={v.code}
                className={`relative flex gap-3.5 overflow-hidden rounded-2xl border border-app surface p-4 ${tone.muted ? 'opacity-60' : ''}`}
              >
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50">
                  <Ticket size={22} weight="fill" className="text-brand-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold">{discount}</span>
                    <Chip tone={tone.chip}>{t(`profile.rewards.wallet.status.${v.status}`)}</Chip>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {v.description ?? t('profile.rewards.wallet.minSpend', { amount: formatIDR(v.minSpend) })}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="rounded-md border border-dashed border-app px-2 py-0.5 text-xs font-bold tracking-wide">
                      {v.code}
                    </code>
                    {v.validUntil && (
                      <span className="text-[11px] text-muted">
                        {t('profile.rewards.wallet.until', { date: formatDateTime(v.validUntil).split(',')[0] ?? '' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ============================ Redeem catalog ============================ */

function RedeemCatalog({
  balance,
  onRedeemed,
  anchorRef,
}: {
  balance: number;
  onRedeemed: (newBalance: number) => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const { data, error, loading, reload } = useAsync<RewardItem[]>(() => api.get(endpoints.rewards.catalog));
  const [pending, setPending] = useState<string | null>(null);

  async function redeem(item: RewardItem) {
    setPending(item.id);
    try {
      const result = await api.post<RewardRedemption>(
        endpoints.rewards.redeem,
        { rewardItemId: item.id, idempotencyKey: crypto.randomUUID() },
        true,
      );
      onRedeemed(result.pointsBalance);
      toast(t('profile.rewards.catalog.redeemed', { name: item.name }), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('profile.rewards.catalog.redeemError'), 'error');
    } finally {
      setPending(null);
    }
  }

  return (
    <section ref={anchorRef} className="scroll-mt-4">
      <SectionHeader title={t('profile.rewards.catalog.title')} subtitle={t('profile.rewards.catalog.subtitle')} />
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">{t('profile.rewards.catalog.empty')}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((item) => {
            const outOfStock = item.stock !== null && item.stock <= 0;
            const affordable = balance >= item.pointsCost;
            return (
              <Card key={item.id} className="flex flex-col overflow-hidden p-0">
                <div className="flex aspect-[1.5] items-center justify-center bg-[color:var(--surface-soft)]">
                  <Gift size={30} weight="duotone" className="text-brand-400" />
                </div>
                <div className="flex flex-1 flex-col gap-1 p-4">
                  <div className="text-sm font-bold leading-snug">{item.name}</div>
                  <div className="text-xs text-muted">{item.unit}</div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm font-extrabold text-brand-800">
                      <Coin size={15} weight="fill" className="text-[color:var(--warning)]" />
                      {idr(item.pointsCost)}
                    </span>
                    {outOfStock ? (
                      <span className="rounded-full bg-[color:var(--surface-soft)] px-3 py-1.5 text-xs font-extrabold text-muted">
                        {t('profile.rewards.catalog.soldOut')}
                      </span>
                    ) : affordable ? (
                      <Button className="px-4 py-2 text-xs" loading={pending === item.id} onClick={() => redeem(item)}>
                        {t('profile.rewards.catalog.redeem')}
                      </Button>
                    ) : (
                      <span className="rounded-full bg-[color:var(--surface-soft)] px-3 py-1.5 text-xs font-extrabold text-muted">
                        {t('profile.rewards.catalog.short')}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ============================ How points work ============================ */

function HowPointsWork() {
  const { t } = useT();
  const rules = [
    { icon: ShoppingBag, key: 'earn' },
    { icon: Truck, key: 'reorder' },
    { icon: Gift, key: 'refer' },
  ] as const;
  return (
    <Card className="flex flex-col gap-3.5 p-5">
      <div className="text-base font-extrabold">{t('profile.rewards.how.title')}</div>
      {rules.map(({ icon: Icon, key }) => (
        <div key={key} className="flex gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50">
            <Icon size={18} weight="fill" className="text-brand-600" />
          </span>
          <div>
            <div className="text-sm font-bold">{t(`profile.rewards.how.${key}.title`)}</div>
            <div className="mt-0.5 text-xs leading-snug text-muted">{t(`profile.rewards.how.${key}.body`)}</div>
          </div>
        </div>
      ))}
      <div className="mt-0.5 flex items-center gap-2.5 rounded-xl border border-app bg-[color:var(--warning-bg)] px-3.5 py-3">
        <WarningCircle size={17} weight="fill" className="flex-shrink-0 text-[color:var(--warning)]" />
        <span className="text-[11px] leading-snug text-[color:var(--warning)]">{t('profile.rewards.how.expiry')}</span>
      </div>
    </Card>
  );
}

/* ============================ Ledger + Referral (additive, real features) ============================ */

function LedgerCard({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<Page<PointsTransaction>>(() =>
    api.get(endpoints.loyalty.transactions({ limit: 10 }), true),
  );

  if (loading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  const items = data?.items ?? [];

  return (
    <Card className="flex flex-col p-5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center justify-between gap-2 rounded-lg text-left font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {open ? t('profile.rewards.ledger.hide') : t('profile.rewards.ledger.show')}
        <CaretDown size={18} weight="bold" className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        (items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t('profile.rewards.ledger.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-[color:var(--border)]">
            {items.map((txn) => (
              <li key={txn.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>
                  <span className="block font-semibold">{t(`profile.rewards.txn.${txn.type}`)}</span>
                  <span className="block text-xs text-muted">{formatDateTime(txn.createdAt)}</span>
                </span>
                <span className={`font-extrabold tabular-nums ${txn.points < 0 ? 'text-[color:var(--danger)]' : 'text-[color:var(--success)]'}`}>
                  {txn.points > 0 ? '+' : ''}
                  {idr(txn.points)}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  );
}

function ReferralCard() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<ReferralSummary>(() => api.get(endpoints.referrals.me, true));
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
      /* clipboard blocked; the code is visible on screen */
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
      setRedeemError(err instanceof ApiError ? err.message : t('profile.rewards.referral.redeemError'));
    } finally {
      setRedeeming(false);
    }
  }

  if (loading) return <Skeleton className="h-52 w-full rounded-2xl" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const stats = [
    { label: t('profile.rewards.referral.statReferred'), value: idr(data.referredCount) },
    { label: t('profile.rewards.referral.statQualified'), value: idr(data.qualifiedCount) },
    { label: t('profile.rewards.referral.statPoints'), value: idr(data.pointsEarned) },
  ];

  return (
    <Card className="flex flex-col gap-5 p-5">
      <span className="flex items-center gap-2 font-bold">
        <Gift size={20} weight="fill" className="text-brand-600" />
        {t('profile.rewards.referral.title')}
      </span>
      <div>
        <p className="mb-1.5 text-sm text-muted">{t('profile.rewards.referral.codeLabel')}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 px-4 py-3 text-center text-lg font-extrabold tracking-[0.2em] text-brand-800">
            {data.code.code}
          </code>
          <Button variant="secondary" onClick={copy} type="button" aria-label={t('profile.rewards.referral.copyAria')}>
            {copied ? <CheckCircle size={18} weight="fill" /> : <Copy size={18} weight="bold" />}
            {copied ? t('profile.rewards.referral.copied') : t('profile.rewards.referral.copy')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">{t('profile.rewards.referral.hint')}</p>
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
        <Field label={t('profile.rewards.referral.haveCode')} htmlFor="referralCode">
          <div className="flex items-center gap-2">
            <Input id="referralCode" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A1B2C3D4" autoCapitalize="characters" disabled={redeemed} />
            <Button type="submit" loading={redeeming} disabled={!code.trim() || redeemed}>
              {t('profile.rewards.referral.use')}
            </Button>
          </div>
        </Field>
        {redeemed && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[color:var(--success)]" role="status">
            <CheckCircle size={16} weight="fill" />
            {t('profile.rewards.referral.redeemed')}
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

/* ============================ Page ============================ */

function RewardsInner() {
  const { t } = useT();
  const account = useAsync<LoyaltyAccount>(() => api.get(endpoints.loyalty.me, true));
  const tiers = useAsync<TierBenefit[]>(() => api.get(endpoints.loyalty.tiers));
  const [balance, setBalance] = useState<number | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const catalogRef = useRef<HTMLDivElement>(null);

  const acc = account.data;
  const liveBalance = balance ?? acc?.pointsBalance ?? 0;

  const scrollToCatalog = () => catalogRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const showLedger = () => {
    setLedgerOpen(true);
    document.getElementById('rewards-ledger')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex flex-col gap-8">
      <h1 className="flex items-center gap-2.5 text-[30px] font-extrabold tracking-tight">
        <Sparkle size={28} weight="fill" className="text-brand-600" />
        {t('profile.rewards.title')}
      </h1>

      {account.loading || tiers.loading ? (
        <Skeleton className="h-64 w-full rounded-3xl" />
      ) : account.error ? (
        <ErrorState message={account.error} onRetry={account.reload} />
      ) : acc ? (
        <Hero account={{ ...acc, pointsBalance: liveBalance }} tiers={tiers.data ?? []} onRedeemClick={scrollToCatalog} />
      ) : null}

      <VoucherWallet onHistory={showLedger} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <RedeemCatalog balance={liveBalance} onRedeemed={setBalance} anchorRef={catalogRef} />
        <HowPointsWork />
      </div>

      <div id="rewards-ledger" className="grid gap-5 scroll-mt-4 md:grid-cols-2">
        <LedgerCard open={ledgerOpen} onToggle={() => setLedgerOpen((v) => !v)} />
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
