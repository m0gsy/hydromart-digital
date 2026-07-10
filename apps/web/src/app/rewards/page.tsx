'use client';

import { useState } from 'react';
import { Gift, Sparkle, Trophy } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { tierProgress } from '@/lib/loyalty';
import { useAsync } from '@/lib/use-async';
import type {
  LoyaltyAccount,
  Page,
  PointsTransaction,
  PointsTxnType,
  ReferralSummary,
  TierBenefit,
} from '@/lib/types';

const TIER_TONE: Record<string, 'neutral' | 'brand' | 'success' | 'warning'> = {
  REGULAR: 'neutral',
  SILVER: 'neutral',
  GOLD: 'warning',
  PLATINUM: 'brand',
};

const TXN_LABEL: Record<PointsTxnType, string> = {
  EARN: 'Earned',
  REWARD: 'Reward',
  ADJUST: 'Adjustment',
  EXPIRE: 'Expired',
};

function LoyaltyCard() {
  const account = useAsync<LoyaltyAccount>(() => api.get(endpoints.loyalty.me, true));
  const tiers = useAsync<TierBenefit[]>(() => api.get(endpoints.loyalty.tiers));

  if (account.loading || tiers.loading) return <Skeleton className="h-52 w-full" />;
  if (account.error) return <ErrorState message={account.error} onRetry={account.reload} />;
  if (!account.data) return null;

  const acc = account.data;
  const ladder = tiers.data ?? [];
  const progress = tierProgress(ladder, acc.lifetimePoints);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-muted">
          <Trophy size={18} weight="fill" className="text-brand-500" />
          Membership
        </span>
        <Badge tone={TIER_TONE[acc.tier] ?? 'neutral'}>{acc.tier}</Badge>
      </div>

      <div>
        <p className="text-sm text-muted">Points balance</p>
        <p className="text-4xl font-bold tabular-nums">{acc.pointsBalance.toLocaleString('id-ID')}</p>
        <p className="mt-1 text-xs text-muted">
          {acc.lifetimePoints.toLocaleString('id-ID')} lifetime points
          {acc.discountRate > 0 && ` · ${Math.round(acc.discountRate * 100)}% member discount at checkout`}
        </p>
      </div>

      {progress.next ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            {progress.pointsToNext.toLocaleString('id-ID')} points to{' '}
            <span className="font-semibold">{progress.next.tier}</span>
          </p>
        </div>
      ) : (
        <p className="text-xs font-medium text-brand-700">You&apos;ve reached the top tier.</p>
      )}

      {ladder.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ladder.map((t) => (
            <div
              key={t.tier}
              className={`rounded-lg border p-2 text-center ${
                t.tier === acc.tier ? 'border-brand-600 bg-brand-50' : 'border-app'
              }`}
            >
              <p className="text-xs font-semibold">{t.tier}</p>
              <p className="text-xs text-muted">{Math.round(t.discountRate * 100)}% off</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function LedgerCard() {
  const { data, error, loading, reload } = useAsync<Page<PointsTransaction>>(() =>
    api.get(endpoints.loyalty.transactions({ limit: 10 }), true),
  );

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const items = data?.items ?? [];
  return (
    <Card className="flex flex-col p-5">
      <h2 className="mb-3 font-semibold">Points activity</h2>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          No activity yet. Complete an order to start earning points.
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--border)]">
          {items.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
              <span>
                <span className="block font-medium">{TXN_LABEL[t.type]}</span>
                <span className="block text-xs text-muted">{formatDateTime(t.createdAt)}</span>
              </span>
              <span
                className={`font-semibold tabular-nums ${t.points < 0 ? 'text-red-600' : 'text-green-700'}`}
              >
                {t.points > 0 ? '+' : ''}
                {t.points.toLocaleString('id-ID')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

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
      setRedeemError(err instanceof ApiError ? err.message : 'Could not redeem that code.');
    } finally {
      setRedeeming(false);
    }
  }

  if (loading) return <Skeleton className="h-52 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <span className="flex items-center gap-2 text-sm font-medium text-muted">
        <Gift size={18} weight="fill" className="text-brand-500" />
        Refer a friend
      </span>

      <div>
        <p className="text-sm text-muted">Your code</p>
        <div className="flex items-center gap-2">
          <code className="rounded-lg bg-[color:var(--surface-muted)] px-3 py-2 text-lg font-bold tracking-widest">
            {data.code.code}
          </code>
          <Button variant="secondary" onClick={copy} type="button">
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Friends enter this code, and you both earn points when their first order completes.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-app p-2">
          <p className="text-lg font-bold tabular-nums">{data.referredCount}</p>
          <p className="text-xs text-muted">Referred</p>
        </div>
        <div className="rounded-lg border border-app p-2">
          <p className="text-lg font-bold tabular-nums">{data.qualifiedCount}</p>
          <p className="text-xs text-muted">Qualified</p>
        </div>
        <div className="rounded-lg border border-app p-2">
          <p className="text-lg font-bold tabular-nums">{data.pointsEarned.toLocaleString('id-ID')}</p>
          <p className="text-xs text-muted">Points</p>
        </div>
      </div>

      <form onSubmit={redeem} className="flex flex-col gap-2 border-t border-app pt-4">
        <Field label="Have a friend's code?" htmlFor="referralCode">
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
              Redeem
            </Button>
          </div>
        </Field>
        {redeemed && (
          <p className="text-sm font-medium text-green-700" role="status">
            Code applied — you&apos;ll earn points when your first order completes.
          </p>
        )}
        {redeemError && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {redeemError}
          </p>
        )}
      </form>
    </Card>
  );
}

function RewardsInner() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Sparkle size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">Rewards</h1>
      </div>
      <LoyaltyCard />
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
