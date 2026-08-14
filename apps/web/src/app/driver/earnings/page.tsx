'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowUp, CaretRight, Coins, Target, TrendUp } from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { CourierEarningsSummary, CourierLedgerEntry, CourierWithdrawal } from '@/lib/types';

const WHEN = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

// Dictionary KEYS — module scope, so t() runs at the call site instead.
const STATUS_LABEL: Record<CourierWithdrawal['status'], string> = {
  PROCESSING: 'hrFix.earnings.processing',
  PAID: 'hrFix.earnings.sent',
  FAILED: 'hrFix.earnings.failed',
};

function Earnings() {
  const { t } = useT();
  const router = useRouter();
  const load = useAsync<CourierEarningsSummary>(
    () => api.get(endpoints.courierPayout.summary, true),
    [],
  );

  const [withdrawing, setWithdrawing] = useState(false);
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (load.loading) return <div className="p-5"><Skeleton className="h-72 w-full" /></div>;
  if (load.error || !load.data) {
    return <div className="p-5"><ErrorState message={load.error ?? t('hrFix.earnings.loadFailed')} onRetry={load.reload} /></div>;
  }

  const { availableBalance, monthEarnings, recentEntries, recentWithdrawals } = load.data;
  const want = Number(amount) || 0;
  const overBalance = want > availableBalance;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.courierPayout.withdraw,
        { amount: want, bankAccountRef: bank.trim() },
        true,
      );
      setWithdrawing(false);
      setAmount('');
      setBank('');
      await load.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('hrFix.earnings.withdrawFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 text-sm font-extrabold">{t('hrFix.earnings.title')}</div>
      </header>

      <Card className="bg-brand-600 p-5 text-on-brand">
        <div className="text-xs font-bold opacity-80">{t('hrFix.earnings.available')}</div>
        <Money amount={availableBalance} className="mt-1 text-3xl font-extrabold" />
        <div className="mt-3 flex items-center gap-1.5 text-xs opacity-90">
          <TrendUp size={15} weight="fill" />
          Bulan ini <Money amount={monthEarnings} className="font-bold" />
        </div>
      </Card>

      <Link
        href="/driver/goal"
        className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-white p-3.5"
      >
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Target size={18} weight="fill" />
        </span>
        <span className="flex-1 text-sm font-bold">{t('hrFix.earnings.shiftTarget')}</span>
        <CaretRight size={16} className="text-[color:var(--muted)]" />
      </Link>

      {withdrawing ? (
        <Card className="space-y-3 p-4">
          <div className="text-sm font-extrabold">{t('hrFix.earnings.withdraw')}</div>
          <Field label={t('hrFix.earnings.amount')} htmlFor="amount">
            <Input
              id="amount"
              inputMode="numeric"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </Field>
          <Field label={t('hrFix.earnings.account')} htmlFor="bank">
            <Input
              id="bank"
              placeholder={t('hrFix.earnings.accountHint')}
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              maxLength={120}
            />
          </Field>
          {overBalance && <p className="text-sm text-red-600">{t('hrFix.earnings.overBalance')}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => { setWithdrawing(false); setError(null); }}>
              Batal
            </Button>
            <Button
              loading={busy}
              disabled={want <= 0 || overBalance || bank.trim() === ''}
              className="flex-1"
              onClick={submit}
            >
              Tarik
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          variant="ghost"
          className="w-full"
          disabled={availableBalance <= 0}
          onClick={() => setWithdrawing(true)}
        >
          <ArrowUp size={16} weight="bold" className="mr-1" />
          Tarik saldo
        </Button>
      )}

      <div className="text-sm font-extrabold">{t('hrFix.earnings.breakdown')}</div>
      {recentEntries.length === 0 ? (
        <CenterState icon={<Coins size={32} />} title={t('hrFix.earnings.emptyTitle')}>
          Ongkos antar akan muncul di sini setelah kamu menyelesaikan pengantaran.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2">
          {recentEntries.map((e) => (
            <LedgerRow key={e.id} entry={e} />
          ))}
        </div>
      )}

      {recentWithdrawals.length > 0 && (
        <>
          <div className="text-sm font-extrabold">{t('hrFix.earnings.withdrawHistory')}</div>
          <div className="flex flex-col gap-2">
            {recentWithdrawals.map((w) => (
              <WithdrawalRow key={w.id} withdrawal={w} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LedgerRow({ entry }: { entry: CourierLedgerEntry }) {
  const credit = entry.amount >= 0;
  return (
    <Card className="flex items-center justify-between p-3.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold">{entry.description}</div>
        <div className="text-[11px] tabular-nums text-[color:var(--muted)]">
          {WHEN.format(new Date(entry.occurredAt))}
        </div>
      </div>
      <div className={`shrink-0 text-sm font-extrabold ${credit ? 'text-green-600' : 'text-red-600'}`}>
        {credit ? '+' : '−'}
        <Money amount={Math.abs(entry.amount)} className="font-extrabold" />
      </div>
    </Card>
  );
}

function WithdrawalRow({ withdrawal: w }: { withdrawal: CourierWithdrawal }) {
  const { t } = useT();
  const tone =
    w.status === 'PAID' ? 'text-green-600' : w.status === 'FAILED' ? 'text-red-600' : 'text-amber-600';
  return (
    <Card className="flex items-center justify-between p-3.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold">{w.bankAccountRef}</div>
        <div className="text-[11px] tabular-nums text-[color:var(--muted)]">
          {WHEN.format(new Date(w.createdAt))} · <span className={tone}>{t(STATUS_LABEL[w.status])}</span>
        </div>
      </div>
      <Money amount={w.amount} className="shrink-0 text-sm font-extrabold" />
    </Card>
  );
}

export default function DriverEarningsPage() {
  return (
    <DriverShell nav={false}>
      <Earnings />
    </DriverShell>
  );
}
