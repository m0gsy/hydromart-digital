'use client';

import { useState } from 'react';
import { Lock } from '@phosphor-icons/react';
import { BUSINESS_TZ, monthWib } from '@/lib/wib';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { can, canViewDepotFinance } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { ReportDepotMonthly } from '@/lib/types';

/*
 * CA-2-63: the money period came from `toISOString()`, which is UTC.
 *
 * Jakarta is UTC+7, so between midnight and 07:00 on the first of a month this read the
 * PREVIOUS month — a manager opening the review before breakfast on 1 September got
 * August's numbers under a heading that said September. And both were module constants,
 * frozen when the bundle loaded and computed on the server during SSR, so the answer also
 * depended on which machine rendered it.
 *
 * `monthWib` is the same helper every other business-date read in the app already uses.
 */
const MONTH_KEY = monthWib();
const MONTH = new Intl.DateTimeFormat('id-ID', {
  timeZone: BUSINESS_TZ,
  month: 'long',
  year: 'numeric',
}).format(new Date());

type Stat = { label: string; value: string; caption: string };
type Row = { label: string; value: string };

function Panel({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-sm font-bold text-[color:var(--text-muted)]">{title}</h2>
      <dl className="flex flex-col divide-y divide-[color:var(--border)]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-sm text-[color:var(--text-muted)]">{r.label}</dt>
            <dd className="text-sm font-semibold tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** What depot-service reports about one depot's month (#17). */
interface MonthlyCloseView {
  close: { daysClosed: number; closedAt: string; reopenedAt: string | null } | null;
  missingDays: string[];
}

/** How many missing dates to spell out before the message just counts the rest. */
const MISSING_DAYS_SHOWN = 5;

/**
 * "Tutup bulan" (#17) — the month-level seal above daily close. Refuses on the server while
 * any day in the month is still open; this panel reads that same list to say WHICH days,
 * rather than a bare refusal the operator has to go find out about one day at a time.
 */
function MonthlyClose({ depotId }: { depotId: string }) {
  const { t } = useT();
  const { customer } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useAsync<MonthlyCloseView>(
    () => api.get(endpoints.depots.monthlyClose(depotId, MONTH_KEY), true),
    [depotId],
  );

  const closed = state.data?.close && !state.data.close.reopenedAt;

  async function run(reopen: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        reopen ? endpoints.depots.reopenMonth(depotId) : endpoints.depots.closeMonth(depotId),
        { businessMonth: MONTH_KEY },
        true,
      );
      state.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('hrFix.monthlyReview.closeMonthError'));
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) return <Skeleton className="h-14 w-full" />;
  // A 403, or a depot-service outage, falling through to the button would invite an action
  // whose precondition (every day closed) was never actually read — the same D-7 reasoning
  // the daily close panel follows.
  if (state.error) {
    return (
      <Card className="p-4 text-sm font-medium text-muted">
        {t('hrFix.monthlyReview.monthCloseStateUnreadable')}
      </Card>
    );
  }

  const missing = state.data?.missingDays ?? [];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-[color:var(--text-muted)]">
          {t('hrFix.monthlyReview.closeMonth')}
        </h2>
        {closed ? (
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
              <Lock size={12} weight="bold" className="inline" />{' '}
              {t('hrFix.monthlyReview.monthClosed')}
            </span>
            {/* Reopening is head office only — a depot that can reopen its own month can
                rewrite a total it already signed off. */}
            {can('dailyCloseReopen', customer?.role) && (
              <Button variant="ghost" onClick={() => void run(true)} loading={busy}>
                {t('hrFix.monthlyReview.reopenMonth')}
              </Button>
            )}
          </div>
        ) : (
          <Button
            variant="ghost"
            onClick={() => void run(false)}
            loading={busy}
            disabled={missing.length > 0}
          >
            <Lock size={16} weight="bold" /> {t('hrFix.monthlyReview.closeMonth')}
          </Button>
        )}
      </div>
      {!closed && missing.length > 0 && (
        <p className="text-[11px] font-semibold text-[color:var(--warning)]">
          {t('hrFix.monthlyReview.missingDays', {
            n: missing.length,
            list:
              missing.length > MISSING_DAYS_SHOWN
                ? `${missing.slice(0, MISSING_DAYS_SHOWN).join(', ')} (+${missing.length - MISSING_DAYS_SHOWN})`
                : missing.join(', '),
          })}
        </p>
      )}
      {error && (
        <p className="text-[11px] font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

function MonthlyReviewBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const { selected, depots, scopedId } = useDepot();
  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? null;
  const depotName = depot ? `${depot.name}` : 'Depot';

  const review = useAsync<ReportDepotMonthly | null>(
    () =>
      depot
        ? api.get(endpoints.reports.depotMonthly(depot.id, MONTH_KEY), true)
        : Promise.resolve(null),
    [depot?.id],
  );

  const r = review.data;
  /**
   * "—" here now means one named service could not be read, not "nobody ever built this".
   * The caption says which, because a manager who can see that payroll is the missing term
   * can go and ask for it; a bare dash sends them nowhere.
   */
  const missingTerms = (b: ReportDepotMonthly['profitBreakdown'] | undefined): string => {
    if (!b) return t('hrFix.monthlyReview.needsCostData');
    const missing = [
      b.cogsIdr === null ? t('hrFix.monthlyReview.termCogs') : null,
      b.payrollIdr === null ? t('hrFix.monthlyReview.termPayroll') : null,
      b.opexIdr === null ? t('hrFix.monthlyReview.cashCost') : null,
    ].filter(Boolean);
    return missing.length > 0
      ? t('hrFix.monthlyReview.unreadTerms', { terms: missing.join(', ') })
      : t('hrFix.monthlyReview.profitFormula');
  };
  const stats: Stat[] = [
    {
      label: t('hrFix.monthlyReview.orders'),
      value: r ? r.orders.toLocaleString('id-ID') : '—',
      caption: t('hrFix.monthlyReview.thisMonth'),
    },
    {
      label: t('hrFix.monthlyReview.revenue'),
      value: r ? formatIDR(r.revenueIdr) : '—',
      caption: t('hrFix.monthlyReview.nonCancelled'),
    },
    {
      label: t('hrFix.monthlyReview.avgSla'),
      value: r?.slaPct != null ? `${r.slaPct}%` : '—',
      caption:
        r?.slaPct != null
          ? t('hrFix.monthlyReview.onTimeDeliveries')
          : t('hrFix.monthlyReview.noDeliveries'),
    },
    {
      label: t('hrFix.monthlyReview.netProfit'),
      value: r?.netProfitIdr != null ? formatIDR(r.netProfitIdr) : '—',
      caption: missingTerms(r?.profitBreakdown),
    },
  ];

  /**
   * The arithmetic behind "Laba bersih", spelled out. A net profit nobody can decompose is
   * a number nobody can dispute — and these two costs come from two places that CAN
   * overlap (a purchase order in the system plus a "bayar supplier" line in the cash book),
   * so showing the terms is what makes a double count visible instead of silent.
   */
  const idrOrDash = (v: number | null | undefined): string => (v == null ? '—' : formatIDR(v));
  const profit: Row[] = [
    { label: t('hrFix.monthlyReview.turnover'), value: r ? formatIDR(r.revenueIdr) : '—' },
    {
      label: t('hrFix.monthlyReview.purchasesReceived'),
      value: idrOrDash(r?.profitBreakdown.cogsIdr),
    },
    { label: t('hrFix.monthlyReview.payrollNet'), value: idrOrDash(r?.profitBreakdown.payrollIdr) },
    { label: t('hrFix.monthlyReview.cashOut'), value: idrOrDash(r?.profitBreakdown.opexIdr) },
  ];

  /*
   * Governance: approvals, stock counts and the daily close, all owned by depot-service and
   * read over one internal route. These were three literal '—' strings, which reads exactly
   * like a depot that reviewed nothing and counted nothing — the report the SOP asks for.
   *
   * A null `governance` (depot-service unreachable) keeps the dashes AND says so, because
   * "0 selisih" is the sentence a manager stops reading at.
   */
  const g = r?.governance ?? null;
  const signed = (v: number): string => (v > 0 ? `+${formatIDR(v)}` : formatIDR(v));
  const governance: Row[] = [
    {
      label: t('hrFix.monthlyReview.approvalsReviewed'),
      value: g ? g.approvalsReviewed.toLocaleString('id-ID') : '—',
    },
    {
      label: t('hrFix.monthlyReview.stocktakeVariance'),
      value: g ? signed(g.opnameVarianceIdr) : '—',
    },
    {
      label: t('hrFix.monthlyReview.settlementVariance'),
      value: g ? signed(g.settlementVarianceIdr) : '—',
    },
    // The denominator: a variance of 0 over 2 closed days is not a clean month, it is two
    // days of bookkeeping and 28 days nobody counted.
    { label: t('hrFix.monthlyReview.daysClosed'), value: g ? `${g.daysClosed} hari` : '—' },
  ];

  // Depot SOP: the monthly report is read in galon, in this order and with these words.
  // Omset is the revenue figure already on the stat row above; it is repeated here because
  // the SOP sheet reads as one block and a manager copies it line by line.
  const galon: Row[] = [
    {
      label: t('hrFix.monthlyReview.gallonsLastMonth'),
      value: r ? r.prevGallons.toLocaleString('id-ID') : '—',
    },
    {
      label: t('hrFix.monthlyReview.gallonsThisMonth'),
      value: r ? r.gallons.toLocaleString('id-ID') : '—',
    },
    {
      label: t('hrFix.monthlyReview.difference'),
      value: r ? `${r.gallonsDelta > 0 ? '+' : ''}${r.gallonsDelta.toLocaleString('id-ID')}` : '—',
    },
    {
      label: t('hrFix.monthlyReview.percentage'),
      // '—' when last month sold nothing: there is no percentage, and printing +100% off a
      // zero base is a number somebody would take to a meeting.
      value: r?.growthPct != null ? `${r.growthPct > 0 ? '+' : ''}${r.growthPct}%` : '—',
    },
    {
      label: t('hrFix.monthlyReview.avgPerDay'),
      value: r ? `${r.avgGallonsPerDay.toLocaleString('id-ID')} galon` : '—',
    },
    { label: t('hrFix.monthlyReview.turnoverShort'), value: r ? formatIDR(r.revenueIdr) : '—' },
  ];

  const team: Row[] = [
    {
      label: t('hrFix.monthlyReview.topCourier'),
      value: r?.topCourier
        ? t('hrFix.monthlyReview.courierDelivered', {
            name: r.topCourier.name,
            n: r.topCourier.delivered,
          })
        : '—',
    },
    {
      label: t('hrFix.monthlyReview.activeCustomers'),
      value: r ? r.activeCustomers.toLocaleString('id-ID') : '—',
    },
    { label: t('hrFix.monthlyReview.winBack'), value: '—' },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Card elevated className="flex flex-col gap-1 bg-brand-700 p-6 text-on-brand">
        <p className="text-sm font-medium text-on-brand/80">{t('hrFix.monthlyReview.title')}</p>
        <h1 className="text-xl font-bold">
          {MONTH} · {depotName}
        </h1>
        <p className="text-sm text-on-brand/80">
          {t('hrFix.monthlyReview.forMeeting')}
          {customer?.fullName ? ` · ${customer.fullName}` : ''}
        </p>
      </Card>

      {review.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : review.error ? (
        <ErrorState message={review.error} onRetry={review.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <Card key={s.label} className="flex flex-col gap-1 p-4">
                <p className="text-xs text-[color:var(--text-muted)]">{s.label}</p>
                <p className="text-lg font-bold tabular-nums">{s.value}</p>
                <p className="text-[11px] text-[color:var(--text-muted)]">{s.caption}</p>
              </Card>
            ))}
          </div>

          <Panel title={t('hrFix.monthlyReview.gallonSales')} rows={galon} />

          <Panel title={t('hrFix.monthlyReview.profitBreakdown')} rows={profit} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel title={t('hrFix.monthlyReview.governance')} rows={governance} />
            <Panel title={t('hrFix.monthlyReview.teamCustomers')} rows={team} />
          </div>

          {depot && <MonthlyClose depotId={depot.id} />}
        </>
      )}

      {/* "Unduh PDF" and "Kirim ke head office" were two buttons with no onClick. The PDF
          half is real now (#16) but for the DAILY report at /dashboard/reports — a monthly
          PDF has not been built, so this screen still has no download of its own. No mail
          transport exists anywhere in the repo either. A button that does nothing teaches an
          operator the console ignores them, which is worse than not offering the action. */}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewDepotFinance(customer?.role)) {
    return (
      <CenterState
        title={t('hrFix.monthlyReview.managerOnly')}
        icon={<Lock size={40} weight="fill" />}
      >
        {t('hrFix.monthlyReview.gateBody2')}
      </CenterState>
    );
  }
  return <MonthlyReviewBody />;
}

export default function MonthlyReviewPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
