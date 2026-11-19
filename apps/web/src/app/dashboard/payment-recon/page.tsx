'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Lock, Info, Wallet, CheckCircle, Warning, ArrowCounterClockwise } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Input, ListFooter, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { fetchAllByCursor } from '@/lib/fetch-all-pages';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canConfirmPayment, canViewDepotFinance } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { BUSINESS_TZ, dateInDaysWib, dayStartWib, todayWib } from '@/lib/wib';
import type { Order, Page, Payment, PaymentMethod, PaymentStatus } from '@/lib/types';

/*
 * This screen used to render four invented rows — "ORD-0142 · Budi", Rp 57.000 — with no
 * badge saying so, next to three real KPI cards, and counted "N belum cocok" from them. It
 * now reads the depot's own orders and the payment recorded against each.
 *
 * The join happens here rather than in payment-service because a payment carries a depot
 * only when it was rung up at the counter: `Payment.depotId` is null for every delivery
 * order, deliberately (payment-service/prisma/schema.prisma, `depotId`). Asking payments
 * for "this depot's transactions" would have answered with the till and called it the depot.
 */

/** Rows drawn at a time. The totals above them cover the whole day (flow 8c-1). */
const ROWS = 20;

/** The most order ids payment-service's for-orders read takes at once (its ArrayMaxSize). */
const PAYMENT_CHUNK = 100;

/** An order and whatever payment currently answers for it. */
interface ReconRow {
  id: string;
  ref: string;
  amount: number;
  method: PaymentMethod | null;
  status: PaymentStatus | null;
  /** Cancelled or voided: nothing is owed on it, so it is never "unsettled" (flow 8c-1). */
  cancelled: boolean;
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'COD',
  QRIS: 'QRIS',
  TRANSFER: 'Transfer',
  EWALLET: 'E-wallet',
  VA: 'Virtual account',
};

/**
 * Join one page of orders to their payments.
 *
 * The API answers newest-first, and a second payment for an order only exists because the
 * first failed or was cancelled — so the first row an order hits is its current truth.
 */
function reconRows(orders: Order[], payments: Payment[]): ReconRow[] {
  const current = new Map<string, Payment>();
  for (const p of payments) {
    if (!current.has(p.orderId)) current.set(p.orderId, p);
  }
  return orders.map((o) => {
    const payment = current.get(o.id) ?? null;
    return {
      id: o.id,
      ref: `${o.orderNumber} · ${o.recipientName}`,
      // The order total is what is owed; the payment amount is what was attempted. They
      // agree today (SEC-1 validates one against the other on initiate) — the order is the
      // one that exists even when no payment does.
      amount: o.total,
      method: payment?.method ?? null,
      status: payment?.status ?? null,
      cancelled: o.status === 'CANCELLED' || o.status === 'VOIDED',
    };
  });
}

/**
 * Settled = a PAID payment. A refund settled and then reversed; it is not still owed. A
 * cancelled or voided order owes nothing: the whole day carries every cancellation of the day,
 * and counting those would send the manager looking for money that was never due.
 */
function isSettled(row: ReconRow): boolean {
  return row.cancelled || row.status === 'PAID' || row.status === 'REFUNDED';
}

function methodTotal(rows: ReconRow[], method: PaymentMethod): number {
  return rows
    .filter((r) => r.method === method && r.status === 'PAID')
    .reduce((n, r) => n + r.amount, 0);
}

function MethodCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {loading ? (
        <p className="text-2xl font-bold text-muted">…</p>
      ) : (
        <Money amount={value} className="text-2xl font-bold" />
      )}
    </Card>
  );
}

function StatusBadge({ status, cancelled }: { status: PaymentStatus | null; cancelled: boolean }) {
  const { t } = useT();
  // Money taken on a cancelled order still shows as paid (it is in the drawer until refunded).
  if (cancelled && status !== 'PAID' && status !== 'REFUNDED') {
    return <span className="text-xs font-semibold text-muted">{t('dashB.paymentRecon.cancelled')}</span>;
  }
  if (status === 'PAID') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--success)]">
        <CheckCircle size={14} weight="fill" /> {t('dashB.paymentRecon.settled')}
      </span>
    );
  }
  if (status === 'REFUNDED') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
        <ArrowCounterClockwise size={14} weight="fill" /> {t('dashB.paymentRecon.refunded')}
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--warning)]">
        <Warning size={14} weight="fill" /> {t('dashB.paymentRecon.pending')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--danger)]">
      <Warning size={14} weight="fill" />{' '}
      {status === null ? t('dashB.paymentRecon.noPayment') : t('dashB.paymentRecon.failed')}
    </span>
  );
}

/*
 * O9 — the row is the only place this screen names a problem, and the button that fixes it
 * lives on the order. `href` is null for a role that holds `depotFinance` but not
 * `paymentSettle` (SUPERVISOR, DIREKTUR): handing them a link into a screen they may only
 * read is an affordance that lies. The screen says it is read-only instead.
 */
function ReconRowItem({ row, href }: { row: ReconRow; href: string | null }) {
  const { t } = useT();
  const inner = (
    <>
      <div className="min-w-0">
        <p className="truncate font-medium">{row.ref}</p>
        <p className="text-xs text-muted">
          {row.method ? METHOD_LABEL[row.method] : t('dashB.paymentRecon.noMethod')}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <Money amount={row.amount} className="font-semibold" />
        <div className="mt-0.5">
          <StatusBadge status={row.status} cancelled={row.cancelled} />
        </div>
      </div>
    </>
  );
  const className = 'flex items-center justify-between gap-3 border-b border-app py-3 last:border-0';
  return href ? (
    <Link href={href} className={`${className} hover:bg-[color:var(--surface-soft)]`}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function PaymentReconBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const canSettle = canConfirmPayment(customer?.role);
  const { scopedId, ready, depots } = useDepot();
  const [day, setDay] = useState(() => todayWib());
  const [shown, setShown] = useState(ROWS);
  const dayLabel = useMemo(
    () =>
      new Date(dayStartWib(day)).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: BUSINESS_TZ,
      }),
    [day],
  );

  // Both reads in ONE hook, not two chained ones: as two, the payment read settles once for
  // the empty id list before the orders even land, and the table renders every row as
  // "no payment yet" in that gap — the same screen telling the same lie in a new dialect.
  // One loading flag, one error, one retry, and no row exists before its payment does.
  const recon = useAsync<ReconRow[]>(async () => {
    if (!scopedId) throw new ApiError(0, 'no depot');
    // Flow 8c-1 (owner decision 2026-11-19): EVERY order placed in the chosen WIB day, so the
    // totals are the day's and not the sum of the twenty newest rows.
    const from = dayStartWib(day);
    const to = dayStartWib(dateInDaysWib(1, new Date(from)));
    const orders = await fetchAllByCursor<Order>(({ cursor, limit }) =>
      api.get<Page<Order> & { nextCursor?: string | null }>(
        endpoints.orders.manage({ depotId: scopedId, limit, cursor: cursor ?? undefined, from, to }),
        true,
      ),
    );
    // In chunks the server accepts. An order's payments all come back in its own chunk, so
    // "first one seen is the current one" (reconRows) still holds.
    const payments: Payment[] = [];
    for (let i = 0; i < orders.length; i += PAYMENT_CHUNK) {
      const orderIds = orders.slice(i, i + PAYMENT_CHUNK).map((o) => o.id);
      payments.push(...(await api.post<Payment[]>(endpoints.payments.forOrders, { orderIds }, true)));
    }
    return reconRows(orders, payments);
  }, [scopedId, day]);

  const rows = recon.data ?? [];
  const unsettled = rows.filter((r) => !isSettled(r)).length;
  const loading = !ready || recon.loading;
  const error = recon.error;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('dashB.paymentRecon.title')}</h1>
            <p className="text-sm text-muted tabular-nums">
              {dayLabel}
              {loading || error ? '' : ` · ${t('dashB.paymentRecon.unsettledCount', { n: unsettled })}`}
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t('dashB.paymentRecon.day')}</span>
          <Input
            type="date"
            className="w-auto"
            value={day}
            max={todayWib()}
            onChange={(e) => {
              // A cleared field keeps the day on screen rather than reading "no day".
              if (!e.target.value) return;
              setDay(e.target.value);
              setShown(ROWS);
            }}
          />
        </label>
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title={t('dashB.paymentRecon.noDepots')} icon={<Wallet size={40} weight="fill" />}>
          {t('dashB.paymentRecon.noDepotsBody')}
        </CenterState>
      ) : error && !loading ? (
        <ErrorState message={error} onRetry={recon.reload} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MethodCard label="COD" value={methodTotal(rows, 'CASH')} loading={loading} />
            <MethodCard label="QRIS" value={methodTotal(rows, 'QRIS')} loading={loading} />
            <MethodCard label="Transfer" value={methodTotal(rows, 'TRANSFER')} loading={loading} />
          </div>

          <Card className="flex flex-col p-5">
            <h2 className="mb-1 font-semibold">{t('dashB.paymentRecon.transactions')}</h2>
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">{t('dashB.paymentRecon.empty')}</p>
            ) : (
              <div className="flex flex-col">
                {rows.slice(0, shown).map((r) => (
                  <ReconRowItem
                    key={r.id}
                    row={r}
                    href={canSettle ? `/dashboard/orders?order=${r.id}` : null}
                  />
                ))}
                <ListFooter
                  shown={Math.min(shown, rows.length)}
                  total={rows.length}
                  hasMore={shown < rows.length}
                  onMore={() => setShown((n) => n + ROWS)}
                />
              </div>
            )}
            {!canSettle && (
              <p className="mt-3 text-xs text-muted">{t('dashB.paymentRecon.readOnly')}</p>
            )}
          </Card>

          <Card className="flex gap-3 bg-[color:var(--surface-soft)] p-4">
            <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
            <p className="text-sm text-muted">
              {t('dashB.paymentRecon.info')}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewDepotFinance(customer?.role)) {
    return (
      <CenterState title={t('dashB.paymentRecon.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.paymentRecon.gateBody')}
      </CenterState>
    );
  }
  return <PaymentReconBody />;
}

export default function PaymentReconPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
