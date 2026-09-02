'use client';

import { useMemo, useState } from 'react';
import { Wallet } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type {
  CourierWithdrawal,
  Customer,
  ExecutiveDashboard,
  Page,
  Payment,
  PendingPayout,
  UnsettledMethodBucket,
  Withdrawal,
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

// Design 6a — Pembayaran & payout (cross-depot). "Terkumpul" is executive sales revenue;
// "Belum settle per metode" (left), the payout-release queue (right) and the pending-
// refunds KPI (payment-service refund queue total) are all real. There is no distinct
// "dispute" concept in the data — the KPI honestly shows refunds awaiting HQ approval.
export default function HqPaymentsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const range = useMemo(defaultRange, []);
  const dash = useAsync<ExecutiveDashboard>(() => api.get(endpoints.dashboard.executive(range), true));
  const unsettledQ = useAsync<UnsettledMethodBucket[]>(() =>
    api.get(endpoints.payments.unsettledByMethod(range), true),
  );
  const queueQ = useAsync<PendingPayout[]>(() => api.get(endpoints.payout.hqQueue, true));
  /*
   * G-2: the owner's NAME. payout-service exposes only the account id, and the comment
   * here used to say there was no name source — there is: `auth.staff({role})`, the same
   * read `dashboard/commission` already uses to turn driver ids into names. Fails soft to
   * the short id, which is what the screen showed before.
   */
  const ownersQ = useAsync<Page<Customer>>(
    () =>
      api
        .getCached<Page<Customer>>(
          endpoints.auth.staff({ role: 'FRANCHISE_OWNER', limit: 100 }),
          true,
        )
        .catch(() => ({ items: [], total: 0, page: 1, limit: 100 })),
    [],
  );
  const ownerName = useMemo(() => {
    const byId = new Map((ownersQ.data?.items ?? []).map((o) => [o.id, o.fullName || o.phone]));
    return (id: string) => byId.get(id) ?? shortId(id);
  }, [ownersQ.data]);
  // Real "needs attention" count: payments awaiting HQ refund approval (the queue total).
  const refundsQ = useAsync<Page<Payment>>(() => api.get(endpoints.refunds.queue({ limit: 1 }), true));
  const [releasing, setReleasing] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  // The queue `release` above has been filling with rows nothing could ever move on.
  const processingQ = useAsync<Withdrawal[]>(() => api.get(endpoints.payout.hqProcessing, true));
  const courierProcessingQ = useAsync<CourierWithdrawal[]>(() =>
    api.get(endpoints.payout.hqCourierProcessing, true),
  );

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
      toast(t('hq.payments.release.released', { owner: ownerName(row.franchiseOwnerId) }), 'success');
      queueQ.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setReleasing(null);
    }
  }

  /*
   * Answering the bank, for either kind of withdrawal.
   *
   * FAILED is not a label change: it re-credits the balance in payout-service's own
   * transaction, because the debit went out when the withdrawal was REQUESTED. Both answers
   * are irreversible from this screen, so both ask first.
   */
  async function settle(id: string, url: string, paid: boolean, reload: () => void) {
    const ok = await confirm({
      title: t('common.confirmTitle'),
      message: paid ? t('hq.payments.settle.confirmPaid') : t('hq.payments.settle.confirmFailed'),
      tone: paid ? 'primary' : 'danger',
    });
    if (!ok) return;
    setSettling(id);
    try {
      await api.post(url, {}, true);
      toast(paid ? t('hq.payments.settle.markedPaid') : t('hq.payments.settle.markedFailed'), paid ? 'success' : 'info');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setSettling(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader icon={Wallet} title={t('hq.payments.title')} subtitle={t('hq.payments.subtitle')} />

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
        <Stat
          label={t('hq.payments.kpi.pendingRefunds')}
          // `?? 0` on a refund queue reads as "nothing waiting", which is the answer that
          // makes somebody close the screen.
          value={refundsQ.loading ? '…' : refundsQ.error ? '—' : String(refundsQ.data?.total ?? 0)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Belum settle per metode — REAL (payment-service unsettled aggregate) */}
        <Card className="flex min-w-0 flex-col p-5">
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
        <Card className="flex min-w-0 flex-col p-5">
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
                    <span className="truncate font-medium">{ownerName(r.franchiseOwnerId)}</span>
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

        {/*
          * Penarikan menunggu jawaban bank.
          *
          * `release` above wrote a row that no code path could ever move on, while the ledger
          * had already been debited — PROCESSING was the last state a payout reached, on both
          * the franchise and the courier side. This is the queue that answers it: PAID is the
          * transfer clearing, GAGAL re-credits the balance in the same transaction. Both are
          * irreversible, so both ask first.
          */}
        <Card className="flex min-w-0 flex-col gap-4 p-5 lg:col-span-2">
          <h2 className="font-semibold">{t('hq.payments.settle.title')}</h2>
          <p className="-mt-3 text-xs text-muted">{t('hq.payments.settle.hint')}</p>
          <WithdrawalQueue
            heading={t('hq.payments.settle.franchise')}
            query={processingQ}
            label={(r) => ownerName(r.franchiseOwnerId)}
            busyId={settling}
            onSettle={(row, paid) =>
              settle(
                row.id,
                paid ? endpoints.payout.hqMarkPaid(row.id) : endpoints.payout.hqMarkFailed(row.id),
                paid,
                () => processingQ.reload(),
              )
            }
          />
          <WithdrawalQueue
            heading={t('hq.payments.settle.courier')}
            query={courierProcessingQ}
            label={(r) => shortId(r.courierId)}
            busyId={settling}
            onSettle={(row, paid) =>
              settle(
                row.id,
                paid
                  ? endpoints.payout.hqCourierMarkPaid(row.id)
                  : endpoints.payout.hqCourierMarkFailed(row.id),
                paid,
                () => courierProcessingQ.reload(),
              )
            }
          />
        </Card>
      </div>
    </div>
  );
}

/** One withdrawal queue — the franchise and the courier lists differ only in whose name it is. */
function WithdrawalQueue<T extends { id: string; amount: number; reference: string; bankAccountRef: string }>({
  heading,
  query,
  label,
  busyId,
  onSettle,
}: {
  heading: string;
  query: { loading: boolean; error: string | null; data: T[] | null; reload: () => void };
  label: (row: T) => string;
  busyId: string | null;
  onSettle: (row: T, paid: boolean) => void;
}) {
  const { t } = useT();
  const rows = query.data ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{heading}</h3>
      {query.loading ? (
        <Skeleton className="h-24 w-full" />
      ) : query.error ? (
        <ErrorState message={query.error} onRetry={query.reload} />
      ) : rows.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted">{t('hq.payments.settle.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app p-3"
            >
              <span className="min-w-0">
                <span className="truncate font-medium">{label(r)}</span>
                <span className="mt-0.5 block truncate font-mono text-xs text-muted">
                  {r.reference} · {r.bankAccountRef}
                </span>
                <Money amount={r.amount} className="mt-1 block text-sm font-semibold" />
              </span>
              <span className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  disabled={busyId === r.id}
                  onClick={() => onSettle(r, true)}
                >
                  {t('hq.payments.settle.paid')}
                </Button>
                <Button variant="danger" disabled={busyId === r.id} onClick={() => onSettle(r, false)}>
                  {t('hq.payments.settle.failed')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Last resort when the owner directory could not be read — see `ownerName` above. */
function shortId(id: string): string {
  return `#${id.slice(0, 8)}`;
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}
