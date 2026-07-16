'use client';

import { useMemo, useState } from 'react';
import { Wallet } from '@phosphor-icons/react';

import { Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { PAYMENTS_DISPUTE_COUNT_STUB, StubBadge } from '@/lib/hq/stubs';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type {
  ExecutiveDashboard,
  PendingPayout,
  UnsettledMethodBucket,
} from '@/lib/types';

// Trailing-30-day window, computed once per mount (client-only).
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function Stat({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        {label}
        {badge}
      </p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}

// Design 6a — Pembayaran & payout (cross-depot). "Terkumpul" is executive sales
// revenue; "Belum settle per metode" (left) and the payout-release queue (right) are
// now real (payment-service unsettled aggregate + payout-service HQ queue). Only the
// dispute count has no source yet (badged).
export default function HqPaymentsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const range = useMemo(defaultRange, []);
  const dash = useAsync<ExecutiveDashboard>(() => api.get(endpoints.dashboard.executive(range), true));
  const unsettledQ = useAsync<UnsettledMethodBucket[]>(() =>
    api.get(endpoints.payments.unsettledByMethod(range), true),
  );
  const queueQ = useAsync<PendingPayout[]>(() => api.get(endpoints.payout.hqQueue, true));
  const [releasing, setReleasing] = useState<string | null>(null);

  if (dash.loading) return <Skeleton className="h-96 w-full" />;
  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} />;

  const buckets = dash.data?.sales?.buckets ?? [];
  const collected = buckets.reduce((n, b) => n + b.revenue, 0);
  const unsettledRows = unsettledQ.data ?? [];
  const unsettled = unsettledRows.reduce((n, r) => n + r.amount, 0);
  const queue = queueQ.data ?? [];
  const payoutPending = queue.reduce((n, r) => n + r.availableBalance, 0);

  async function release(row: PendingPayout) {
    setReleasing(row.franchiseOwnerId);
    try {
      await api.post(endpoints.payout.release, { franchiseOwnerId: row.franchiseOwnerId }, true);
      toast(t('hq.payments.release.released', { owner: ownerLabel(row.franchiseOwnerId) }), 'success');
      queueQ.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setReleasing(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Wallet size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('hq.payments.title')}</h1>
          <p className="text-sm text-muted">{t('hq.payments.subtitle')}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('hq.payments.kpi.collected')} value={`Rp ${collected.toLocaleString('id-ID')}`} />
        <Stat
          label={t('hq.payments.kpi.unsettled')}
          value={unsettledQ.loading ? '…' : `Rp ${unsettled.toLocaleString('id-ID')}`}
        />
        <Stat
          label={t('hq.payments.kpi.payoutPending')}
          value={queueQ.loading ? '…' : `Rp ${payoutPending.toLocaleString('id-ID')}`}
        />
        <Stat label={t('hq.payments.kpi.disputes')} value={String(PAYMENTS_DISPUTE_COUNT_STUB)} badge={<StubBadge />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Belum settle per metode — REAL (payment-service unsettled aggregate) */}
        <Card className="flex flex-col p-5">
          <h2 className="mb-3 font-semibold">{t('hq.payments.unsettled.title')}</h2>
          {unsettledQ.loading ? (
            <Skeleton className="h-48 w-full" />
          ) : unsettledQ.error ? (
            <ErrorState message={unsettledQ.error} onRetry={unsettledQ.reload} />
          ) : unsettledRows.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">{t('hq.payments.unsettled.empty')}</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {unsettledRows.map((r) => (
                <li key={r.method} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{t(`hq.payments.unsettled.method.${r.method}`)}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {t('hq.payments.unsettled.count', { n: r.count })}
                    </span>
                  </span>
                  <Money amount={r.amount} className="shrink-0 font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Rilis payout waralaba — REAL (payout-service HQ queue + release) */}
        <Card className="flex flex-col p-5">
          <h2 className="mb-3 font-semibold">{t('hq.payments.release.title')}</h2>
          {queueQ.loading ? (
            <Skeleton className="h-48 w-full" />
          ) : queueQ.error ? (
            <ErrorState message={queueQ.error} onRetry={queueQ.reload} />
          ) : queue.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">{t('hq.payments.release.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {queue.map((r) => (
                <li
                  key={r.franchiseOwnerId}
                  className="flex items-center justify-between gap-3 rounded-xl border border-app p-3"
                >
                  <span className="min-w-0">
                    <span className="truncate font-medium">{ownerLabel(r.franchiseOwnerId)}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {t('hq.payments.release.due', { date: formatDue(r.nextPayoutDate) })}
                    </span>
                    <Money amount={r.availableBalance} className="mt-1 block text-sm font-semibold text-brand-700" />
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => release(r)}
                    disabled={releasing === r.franchiseOwnerId}
                    className="shrink-0"
                  >
                    {t('hq.payments.release.action')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// payout-service exposes only the owner id (no name source); shorten it for display.
function ownerLabel(id: string): string {
  return `#${id.slice(0, 8)}`;
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}
