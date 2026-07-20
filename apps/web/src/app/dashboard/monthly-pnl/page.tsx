'use client';

import { ChartPieSlice, DownloadSimple, FileCsv, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canViewDashboard } from '@/lib/roles';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ReportDepotMonthly } from '@/lib/types';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());
const MONTH_KEY = new Date().toISOString().slice(0, 7); // YYYY-MM

// Spec 8a — monthly P&L: revenue / COGS / opex / net profit / margin.
// ponytail: only revenue is real (order-service depot-monthly). COGS & opex have no
// accounting source, so they are derived from revenue with fixed depot-economics ratios
// (matching the spec's proportions). Replace COST_RATIOS with real ledger lines once
// finance exposes a per-depot P&L endpoint.
const COST_RATIOS = {
  cogsWater: 0.35,
  cogsPackaging: 0.067,
  salaries: 0.175,
  commissionFuel: 0.062,
  rentUtil: 0.038,
};

function MonthlyPnlBody() {
  const { t } = useT();
  const { selected, depots, scopedId } = useDepot();
  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? null;
  const depotName = depot?.name ?? 'Depot';

  const review = useAsync<ReportDepotMonthly | null>(
    () => (depot ? api.get(endpoints.reports.depotMonthly(depot.id, MONTH_KEY), true) : Promise.resolve(null)),
    [depot?.id],
  );

  const revenue = review.data?.revenueIdr ?? 0;
  const cogsWater = Math.round(revenue * COST_RATIOS.cogsWater);
  const cogsPackaging = Math.round(revenue * COST_RATIOS.cogsPackaging);
  const grossProfit = revenue - cogsWater - cogsPackaging;
  const salaries = Math.round(revenue * COST_RATIOS.salaries);
  const commissionFuel = Math.round(revenue * COST_RATIOS.commissionFuel);
  const rentUtil = Math.round(revenue * COST_RATIOS.rentUtil);
  const netProfit = grossProfit - salaries - commissionFuel - rentUtil;
  const margin = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ChartPieSlice size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('mgrFix.pnl.title')}</h1>
          <p className="text-sm text-muted">{t('mgrFix.pnl.subtitle', { depot: depotName, month: MONTH })}</p>
        </div>
      </div>

      {review.loading ? (
        <Skeleton className="h-80 w-full" />
      ) : review.error ? (
        <ErrorState message={review.error} onRetry={review.reload} />
      ) : revenue <= 0 ? (
        <p className="rounded-xl bg-[color:var(--surface-muted)] px-4 py-6 text-center text-sm text-muted">
          {t('mgrFix.pnl.noData')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card elevated className="flex flex-col gap-1 bg-brand-700 p-4 text-on-brand">
              <p className="text-xs font-medium uppercase tracking-wide text-on-brand/70">{t('mgrFix.pnl.netProfit')}</p>
              <p className="text-2xl font-bold tabular-nums">{formatIDR(netProfit)}</p>
            </Card>
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('mgrFix.pnl.netMargin')}</p>
              <p className="text-2xl font-bold tabular-nums">{margin.toLocaleString('id-ID')}%</p>
              <p className="text-[11px] font-semibold text-[color:var(--success)]">{t('mgrFix.pnl.healthy')}</p>
            </Card>
          </div>

          <Card className="flex flex-col px-5 py-2">
            <PnlLine label={t('mgrFix.pnl.revenue')} value={formatIDR(revenue)} bold border />
            <PnlLine label={t('mgrFix.pnl.cogsWater')} value={`−${formatIDR(cogsWater)}`} negative indent />
            <PnlLine label={t('mgrFix.pnl.cogsPackaging')} value={`−${formatIDR(cogsPackaging)}`} negative indent border />
            <PnlLine label={t('mgrFix.pnl.grossProfit')} value={formatIDR(grossProfit)} bold positive border />
            <PnlLine label={t('mgrFix.pnl.salaries')} value={`−${formatIDR(salaries)}`} negative indent />
            <PnlLine label={t('mgrFix.pnl.commissionFuel')} value={`−${formatIDR(commissionFuel)}`} negative indent />
            <PnlLine label={t('mgrFix.pnl.rentUtil')} value={`−${formatIDR(rentUtil)}`} negative indent border />
            <PnlLine label={t('mgrFix.pnl.netProfit')} value={formatIDR(netProfit)} bold brand />
          </Card>

          <p className="text-xs text-muted">{t('mgrFix.pnl.estimate')}</p>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-app px-4 py-2.5 text-sm font-semibold hover:bg-brand-50">
              <DownloadSimple size={18} weight="bold" />
              {t('mgrFix.pnl.downloadPdf')}
            </button>
            <button type="button" className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-app px-4 py-2.5 text-sm font-semibold hover:bg-brand-50">
              <FileCsv size={18} weight="bold" />
              {t('mgrFix.pnl.exportCsv')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PnlLine({
  label,
  value,
  bold,
  indent,
  border,
  negative,
  positive,
  brand,
}: {
  label: string;
  value: string;
  bold?: boolean;
  indent?: boolean;
  border?: boolean;
  negative?: boolean;
  positive?: boolean;
  brand?: boolean;
}) {
  const valueColor = brand ? 'text-brand-700' : negative ? 'text-[color:var(--danger)]' : positive ? 'text-[color:var(--success)]' : '';
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 ${border ? 'border-b border-[color:var(--border)]' : ''}`}>
      <span className={`text-sm ${bold ? 'font-bold' : 'text-muted'} ${indent ? 'pl-3' : ''}`}>{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${bold ? 'font-bold' : ''} ${valueColor}`}>{value}</span>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewDashboard(customer?.role)) {
    return (
      <CenterState title={t('mgrFix.pnl.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('mgrFix.pnl.gateBody')}
      </CenterState>
    );
  }
  return <MonthlyPnlBody />;
}

export default function MonthlyPnlPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
