'use client';

import { useMemo, useState } from 'react';
import { Wallet } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { HqPageHeader } from '@/components/hq/page-header';
import { Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type {
  CourierWithdrawal,
  Customer,
  ExecutiveDashboard,
  Page,
  Payment,
  PayoutBankAccount,
  PendingPayout,
  ReleaseRequest,
  UnsettledMethodBucket,
  Withdrawal,
} from '@/lib/types';

// Trailing-30-day window, computed once per mount (client-only).
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function Stat({ label, value, badge }: { label: string; value: string; badge?: React.ReactNode }) {
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
  const dash = useAsync<ExecutiveDashboard>(() =>
    api.get(endpoints.dashboard.executive(range), true),
  );
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
  /*
   * CA-2-66: the courier settlement queue labelled its rows with eight characters of a
   * UUID, on the same screen where the franchise queue right above it shows a name.
   *
   * The two queues ask the operator for the same decision — mark this payout PAID, or
   * FAILED and credit the money back — and one of them named the person while the other
   * did not. A shortId is not an identity: it cannot be matched against a bank transfer,
   * cannot be read out over the phone, and cannot be recognised as the wrong one.
   */
  const couriersQ = useAsync<Customer[]>(
    () => api.getCached<Customer[]>(endpoints.auth.drivers, true).catch(() => []),
    [],
  );
  const courierName = useMemo(() => {
    const byId = new Map((couriersQ.data ?? []).map((c) => [c.id, c.fullName || c.phone]));
    // Still a shortId when the directory could not be read — a wrong name would be worse
    // than an id, and an empty label worse than both.
    return (id: string) => byId.get(id) ?? shortId(id);
  }, [couriersQ.data]);
  // Real "needs attention" count: payments awaiting HQ refund approval (the queue total).
  const refundsQ = useAsync<Page<Payment>>(() =>
    api.get(endpoints.refunds.queue({ limit: 1 }), true),
  );
  const [releasing, setReleasing] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  /*
   * PYO-2 (owner decision 2026-09-17): the button above asks for a release; somebody else
   * answers it here. FINANCE sees the queue it filled and cannot approve its own rows —
   * the server refuses that too, and this only keeps the buttons off a screen that cannot
   * use them.
   */
  const { customer } = useAuth();
  const mayApprove = can('hqPayoutApprove', customer?.role);
  const requestsQ = useAsync<ReleaseRequest[]>(() =>
    api.get(endpoints.payout.hqReleaseRequests, true),
  );
  // PYO-3: destinations waiting to be checked. Verifying is `hqPayout` (FINANCE), the same
  // capability that requests a release — checking an account is not releasing money.
  const accountsQ = useAsync<PayoutBankAccount[]>(() =>
    api.get(endpoints.payout.hqBankAccounts, true),
  );
  const [checkingAccount, setCheckingAccount] = useState<string | null>(null);
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
      toast(
        t('hq.payments.release.requested', { owner: ownerName(row.franchiseOwnerId) }),
        'success',
      );
      queueQ.reload();
      requestsQ.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setReleasing(null);
    }
  }

  /** PYO-3: confirm or refuse a payout destination before anything is sent to it. */
  async function decideAccount(account: PayoutBankAccount, verify: boolean) {
    const ok = await confirm({
      title: t('common.confirmTitle'),
      message: verify
        ? t('hq.payments.accounts.confirmVerify')
        : t('hq.payments.accounts.confirmReject'),
      tone: verify ? 'primary' : 'danger',
    });
    if (!ok) return;
    setCheckingAccount(account.id);
    try {
      await api.post(
        verify
          ? endpoints.payout.hqVerifyBankAccount(account.id)
          : endpoints.payout.hqRejectBankAccount(account.id),
        {},
        true,
      );
      toast(
        verify ? t('hq.payments.accounts.verified') : t('hq.payments.accounts.rejected'),
        verify ? 'success' : 'info',
      );
      accountsQ.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setCheckingAccount(null);
    }
  }

  /** PYO-2: approve (money moves now) or reject (nothing moves) somebody else's request. */
  async function decide(request: ReleaseRequest, approve: boolean) {
    const ok = await confirm({
      title: t('common.confirmTitle'),
      message: approve
        ? t('hq.payments.release.confirmApprove')
        : t('hq.payments.release.confirmReject'),
      tone: approve ? 'primary' : 'danger',
    });
    if (!ok) return;
    setDeciding(request.id);
    try {
      await api.post(
        approve
          ? endpoints.payout.hqApproveRelease(request.id)
          : endpoints.payout.hqRejectRelease(request.id),
        {},
        true,
      );
      toast(
        approve ? t('hq.payments.release.approved') : t('hq.payments.release.rejected'),
        approve ? 'success' : 'info',
      );
      requestsQ.reload();
      queueQ.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setDeciding(null);
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
      toast(
        paid ? t('hq.payments.settle.markedPaid') : t('hq.payments.settle.markedFailed'),
        paid ? 'success' : 'info',
      );
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setSettling(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Wallet}
        title={t('hq.payments.title')}
        subtitle={t('hq.payments.subtitle')}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('hq.payments.kpi.collected')}
          value={`Rp ${collected.toLocaleString('id-ID')}`}
        />
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
            <p className="py-4 text-center text-sm text-muted">
              {t('hq.payments.unsettled.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {unsettledRows.map((r) => (
                <li key={r.method} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">
                      {t(`hq.payments.unsettled.method.${r.method}`)}
                    </span>
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
                    <Money
                      amount={r.availableBalance}
                      className="mt-1 block text-sm font-semibold text-brand-700"
                    />
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

        {/* PYO-3: a destination is checked once, here, before any payout reaches it. */}
        <Card className="flex min-w-0 flex-col p-5">
          <h2 className="font-semibold">{t('hq.payments.accounts.title')}</h2>
          <p className="mb-3 mt-1 text-xs text-muted">{t('hq.payments.accounts.hint')}</p>
          {accountsQ.loading ? (
            <Skeleton className="h-32 w-full" />
          ) : accountsQ.error ? (
            <ErrorState message={accountsQ.error} onRetry={accountsQ.reload} />
          ) : (accountsQ.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">
              {t('hq.payments.accounts.empty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(accountsQ.data ?? []).map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app p-3"
                >
                  <span className="min-w-0">
                    <span className="truncate font-medium">
                      {a.bankName} · {a.accountNumber}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {a.accountHolder} ·{' '}
                      {a.subjectType === 'OWNER'
                        ? t('hq.payments.accounts.owner')
                        : t('hq.payments.accounts.courier')}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => decideAccount(a, true)}
                      disabled={checkingAccount === a.id}
                    >
                      {t('hq.payments.accounts.verify')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => decideAccount(a, false)}
                      disabled={checkingAccount === a.id}
                    >
                      {t('hq.payments.accounts.reject')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* PYO-2: the second pair of eyes. Requested here, approved by somebody else. */}
        <Card className="flex min-w-0 flex-col p-5">
          <h2 className="font-semibold">{t('hq.payments.release.queueTitle')}</h2>
          <p className="mb-3 mt-1 text-xs text-muted">{t('hq.payments.release.queueHint')}</p>
          {requestsQ.loading ? (
            <Skeleton className="h-32 w-full" />
          ) : requestsQ.error ? (
            <ErrorState message={requestsQ.error} onRetry={requestsQ.reload} />
          ) : (requestsQ.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">
              {t('hq.payments.release.queueEmpty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(requestsQ.data ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app p-3"
                >
                  <span className="min-w-0">
                    <span className="truncate font-medium">{ownerName(r.franchiseOwnerId)}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {t('hq.payments.release.requestedBy', { actor: ownerName(r.requestedBy) })}
                    </span>
                    <Money
                      amount={r.amountAtRequest}
                      className="mt-1 block text-sm font-semibold text-brand-700"
                    />
                  </span>
                  {mayApprove && (
                    <span className="flex shrink-0 gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => decide(r, true)}
                        disabled={deciding === r.id}
                      >
                        {t('hq.payments.release.approve')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => decide(r, false)}
                        disabled={deciding === r.id}
                      >
                        {t('hq.payments.release.reject')}
                      </Button>
                    </span>
                  )}
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
            label={(r) => courierName(r.courierId)}
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
function WithdrawalQueue<
  T extends { id: string; amount: number; reference: string; bankAccountRef: string },
>({
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
                <Button
                  variant="danger"
                  disabled={busyId === r.id}
                  onClick={() => onSettle(r, false)}
                >
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
