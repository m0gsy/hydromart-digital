'use client';

import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLineDown,
  ArrowUpRight,
  Bank,
  Buildings,
  CheckCircle,
  Lock,
  Wallet,
} from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canViewPayout } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { LedgerEntry, LedgerEntryType, PayoutSummary, Withdrawal } from '@/lib/types';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}

// Ledger entry glyph + tint by kind/sign (credit green, debit red, neutral ink).
const ENTRY_ICON: Record<LedgerEntryType, typeof ArrowDownLeft> = {
  SALE_SETTLEMENT: ArrowDownLeft,
  COMMISSION: Buildings,
  STOCK_PURCHASE: ArrowUpRight,
  WITHDRAWAL: Bank,
  ADJUSTMENT: ArrowUpRight,
};

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const Icon = ENTRY_ICON[entry.type];
  const credit = entry.amount >= 0;
  const date = new Date(entry.occurredAt).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return (
    <li className="flex items-center gap-3 border-t border-app py-3 first:border-0">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          credit ? 'bg-[color:var(--success-bg)]' : 'bg-[color:var(--danger-bg)]'
        }`}
      >
        <Icon size={18} weight="fill" className={credit ? 'text-green-700' : 'text-red-600'} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{entry.description}</p>
        <p className="text-xs text-muted">{date}</p>
      </div>
      <span
        className={`shrink-0 text-sm font-bold tabular-nums ${credit ? 'text-green-700' : 'text-red-600'}`}
      >
        {credit ? '+ ' : '− '}
        {formatIDR(Math.abs(entry.amount))}
      </span>
    </li>
  );
}

const QUICK = [2_000_000, 5_000_000];

/** Balance + withdrawal request card (design 9d). Posts, then shows a success receipt. */
function BalanceCard({ summary, onWithdrawn }: { summary: PayoutSummary; onWithdrawn: () => void }) {
  const { t } = useT();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Withdrawal | null>(null);

  const balance = summary.availableBalance;

  async function withdraw() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('dashB.payout.invalidAmount'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const w = await api.post<Withdrawal>(
        endpoints.payout.withdrawals,
        { amount: Math.round(value), bankAccountRef: 'BCA ···· 4821' },
        true,
      );
      setDone(w);
      onWithdrawn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('dashB.payout.withdrawError'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="flex flex-col items-center gap-3 p-7 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--success-bg)]">
          <CheckCircle size={40} weight="fill" className="text-green-700" />
        </span>
        <h2 className="text-xl font-extrabold tracking-tight">{t('dashB.payout.withdrawalProcessed')}</h2>
        <p className="text-sm text-muted">
          <Money amount={done.amount} className="font-bold text-[color:var(--text)]" />{' '}
          {t('dashB.payout.sentTo', { ref: done.bankAccountRef })}
        </p>
        <div className="mt-1 w-full rounded-xl border border-app p-3 text-left text-xs">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted">{t('dashB.payout.ref')}</span>
            <span className="font-mono font-semibold">{done.reference}</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-muted">{t('dashB.payout.status')}</span>
            <span className="font-semibold text-green-700">{t('dashB.payout.processed')}</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="rounded-2xl bg-gradient-to-br from-[#0b4d57] to-[#0c97ac] p-4 text-white">
        <p className="text-xs text-white/80">{t('dashB.payout.availableBalance')}</p>
        <p className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">{formatIDR(balance)}</p>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2.5">
          <Bank size={18} weight="fill" className="text-[#8fe3ee]" />
          <div className="leading-tight">
            <p className="text-xs font-extrabold">BCA ···· 4821</p>
            <p className="text-[10.5px] text-white/70">{t('dashB.payout.registeredAccount')}</p>
          </div>
        </div>
      </div>

      <Field label={t('dashB.payout.amountLabel')} htmlFor="wd-amount">
        <Input
          id="wd-amount"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={String(balance)}
        />
      </Field>
      <div className="flex gap-2">
        {QUICK.filter((q) => q <= balance).map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setAmount(String(q))}
            className="flex-1 rounded-lg border border-app py-2 text-xs font-bold text-muted hover:bg-brand-50"
          >
            {formatIDR(q)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAmount(String(balance))}
          className="flex-1 rounded-lg border border-brand-600 bg-brand-50 py-2 text-xs font-bold text-brand-800"
        >
          {t('dashB.payout.all')}
        </button>
      </div>
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <Button onClick={withdraw} loading={busy} disabled={balance <= 0}>
        <ArrowLineDown size={17} weight="fill" />
        {t('dashB.payout.withdraw')}
      </Button>
    </Card>
  );
}

function PayoutBody() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<PayoutSummary>(() =>
    api.get(endpoints.payout.summary, true),
  );

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const nextPayout = new Date(data.nextPayoutDate).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <Wallet size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashB.payout.title')}</h1>
        <Badge tone="warning">{t('dashB.payout.proposed')}</Badge>
      </div>
      <p className="text-sm text-muted">
        {t('dashB.payout.subtitle')}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('dashB.payout.availableBalance')} value={formatIDR(data.availableBalance)} />
        <Stat label={t('dashB.payout.monthRevenue')} value={formatIDR(data.monthRevenue)} />
        <Stat label={t('dashB.payout.hqCommission')} value={formatIDR(data.monthCommission)} />
        <Stat label={t('dashB.payout.nextPayout')} value={nextPayout} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="flex flex-col p-5">
          <h2 className="mb-1 font-semibold">{t('dashB.payout.ledger')}</h2>
          {data.recentEntries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('dashB.payout.noEntries')}</p>
          ) : (
            <ul className="flex flex-col">
              {data.recentEntries.map((e) => (
                <LedgerRow key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </Card>
        <BalanceCard summary={data} onWithdrawn={reload} />
      </div>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewPayout(customer?.role)) {
    return (
      <CenterState title={t('dashB.payout.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.payout.gateBody')}
      </CenterState>
    );
  }
  return <PayoutBody />;
}

export default function PayoutPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
