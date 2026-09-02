'use client';

import { Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { canViewDepotFinance } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { ReportDepotMonthly } from '@/lib/types';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());
const MONTH_KEY = new Date().toISOString().slice(0, 7); // YYYY-MM

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

function MonthlyReviewBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const { selected, depots, scopedId } = useDepot();
  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? null;
  const depotName = depot ? `${depot.name}` : 'Depot';

  const review = useAsync<ReportDepotMonthly | null>(
    () =>
      depot ? api.get(endpoints.reports.depotMonthly(depot.id, MONTH_KEY), true) : Promise.resolve(null),
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
      caption: r?.slaPct != null ? t('hrFix.monthlyReview.onTimeDeliveries') : t('hrFix.monthlyReview.noDeliveries'),
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
    { label: t('hrFix.monthlyReview.purchasesReceived'), value: idrOrDash(r?.profitBreakdown.cogsIdr) },
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
    { label: t('hrFix.monthlyReview.approvalsReviewed'), value: g ? g.approvalsReviewed.toLocaleString('id-ID') : '—' },
    { label: t('hrFix.monthlyReview.stocktakeVariance'), value: g ? signed(g.opnameVarianceIdr) : '—' },
    { label: t('hrFix.monthlyReview.settlementVariance'), value: g ? signed(g.settlementVarianceIdr) : '—' },
    // The denominator: a variance of 0 over 2 closed days is not a clean month, it is two
    // days of bookkeeping and 28 days nobody counted.
    { label: t('hrFix.monthlyReview.daysClosed'), value: g ? `${g.daysClosed} hari` : '—' },
  ];

  // Depot SOP: the monthly report is read in galon, in this order and with these words.
  // Omset is the revenue figure already on the stat row above; it is repeated here because
  // the SOP sheet reads as one block and a manager copies it line by line.
  const galon: Row[] = [
    { label: t('hrFix.monthlyReview.gallonsLastMonth'), value: r ? r.prevGallons.toLocaleString('id-ID') : '—' },
    { label: t('hrFix.monthlyReview.gallonsThisMonth'), value: r ? r.gallons.toLocaleString('id-ID') : '—' },
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
    { label: t('hrFix.monthlyReview.topCourier'), value: r?.topCourier ? `${r.topCourier.name} · ${r.topCourier.delivered} antar` : '—' },
    { label: t('hrFix.monthlyReview.activeCustomers'), value: r ? r.activeCustomers.toLocaleString('id-ID') : '—' },
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
        </>
      )}

      {/* "Unduh PDF" and "Kirim ke head office" were two buttons with no onClick. Neither
          has anything behind it: this repo has no PDF renderer (the scheduled-reports
          executor refuses PDF outright rather than shipping an .xlsx under a .pdf name) and
          no mail transport of any kind. A button that does nothing teaches an operator the
          console ignores them, which is worse than not offering the action. */}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewDepotFinance(customer?.role)) {
    return (
      <CenterState title={t('hrFix.monthlyReview.managerOnly')} icon={<Lock size={40} weight="fill" />}>
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
