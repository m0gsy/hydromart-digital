'use client';

import {
  ArrowDownLeft,
  ArrowUpRight,
  Bank,
  Buildings,
  Lock,
  Wallet,
} from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Badge,
  Button,
  Card,
  CenterState,
  ErrorState,
  Money,
  Skeleton,
} from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { type PartnerBill, monthName } from '@/lib/partner-bills';
import { canViewPayout } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type {
  LedgerEntry,
  LedgerEntryType,
  PayoutSummary,
} from '@/lib/types';

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
        <Icon size={18} weight="fill" className={credit ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]'} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{entry.description}</p>
        <p className="text-xs text-muted">{date}</p>
      </div>
      <span
        className={`shrink-0 text-sm font-bold tabular-nums ${credit ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]'}`}
      >
        {credit ? '+ ' : '− '}
        {formatIDR(Math.abs(entry.amount))}
      </span>
    </li>
  );
}

/**
 * HD-23 (owner decision 2026-11-26, "Tagihan saja"): customers pay the depot's own account, so HQ
 * collects its royalty only through the monthly bill and the ledger balance is bookkeeping, never
 * a purse. There is no withdraw button; this says why, and lists the bills sent to the owner.
 */
function BillsCard({ summary }: { summary: PayoutSummary }) {
  const { t, locale } = useT();
  const bills = useAsync<PartnerBill[]>(() => api.get(endpoints.partnerBills.mine, true));
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="rounded-2xl bg-gradient-to-br from-[#0b4d57] to-[#0c97ac] p-4 text-white">
        <p className="text-xs text-white/80">{t('dashB.payout.ledgerBalance')}</p>
        <p className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
          {formatIDR(summary.availableBalance)}
        </p>
        <p className="mt-2 text-xs text-white/80">{t('dashB.payout.byBill')}</p>
      </div>
      <h2 className="font-semibold">{t('dashB.payout.billsTitle')}</h2>
      {bills.loading ? (
        <Skeleton className="h-16 w-full" />
      ) : bills.error ? (
        <ErrorState message={t('dashB.payout.billsError')} onRetry={bills.reload} />
      ) : (Array.isArray(bills.data) ? bills.data : []).length === 0 ? (
        <p className="text-sm text-muted">{t('dashB.payout.billsEmpty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[color:var(--border)]">
          {(Array.isArray(bills.data) ? bills.data : []).map((b) => (
            <li key={b.id} className="flex flex-col gap-1 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">
                  {monthName(b.month, locale)} · {b.legalEntityName}
                </span>
                <Money amount={b.totalIdr} className="font-bold tabular-nums" />
              </div>
              {b.status === 'VOID' && (
                <p className="text-xs font-medium text-[color:var(--danger)]">
                  {t('dashB.payout.billVoid', { reason: b.voidReason ?? '' })}
                </p>
              )}
              {b.status === 'SENT' && b.bank && (
                <p className="text-xs text-muted">
                  {t('dashB.payout.billBank', {
                    bank: b.bank.bankName,
                    number: b.bank.bankAccountNumber,
                    holder: b.bank.bankAccountHolder,
                  })}
                </p>
              )}
              <ul className="text-xs text-muted">
                {(b.lines ?? []).map((l) => (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span className="truncate">{l.label}</span>
                    <span className="tabular-nums">{formatIDR(l.amountIdr)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PayoutBody() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<PayoutSummary>(() =>
    api.get(endpoints.payout.summary, true),
  );

  // First load only: a refetch keeps the data on screen.
  if (loading && !data) return <Skeleton className="h-96 w-full" />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <Wallet size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashB.payout.title')}</h1>
        <Badge tone="warning">{t('dashB.payout.proposed')}</Badge>
      </div>
      <p className="text-sm text-muted">{t('dashB.payout.subtitle')}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('dashB.payout.ledgerBalance')} value={formatIDR(data.availableBalance)} />
        <Stat label={t('dashB.payout.monthRevenue')} value={formatIDR(data.monthRevenue)} />
        <Stat label={t('dashB.payout.hqCommission')} value={formatIDR(data.monthCommission)} />
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
        <div className="flex flex-col gap-4">
          <BillsCard summary={data} />
          {/* The summary already carried the last withdrawals; the page never drew them, so a
              request vanished from the screen the moment the form closed. */}
          {data.recentWithdrawals.length > 0 && (
            <Card className="flex flex-col p-5">
              <h2 className="mb-1 font-semibold">{t('dashB.payout.withdrawHistory')}</h2>
              <ul className="flex flex-col divide-y divide-[color:var(--border)]">
                {data.recentWithdrawals.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-semibold tabular-nums">{formatIDR(w.amount)}</div>
                      <div className="truncate text-xs text-muted">
                        {w.reference} · {new Date(w.createdAt).toLocaleDateString('id-ID')}
                      </div>
                    </div>
                    <Badge tone={w.status === 'PAID' ? 'success' : w.status === 'FAILED' ? 'danger' : 'warning'}>
                      {t(`dashB.payout.wd${w.status}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
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
