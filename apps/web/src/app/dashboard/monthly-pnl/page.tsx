'use client';

import { ChartPieSlice, Lock, WarningCircle } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { canViewDashboard } from '@/lib/roles';
import type { OperationalCogsUncoveredReason, OperationalMonthlyPnl } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

const NOW = new Date();
const MONTH_KEY = NOW.toISOString().slice(0, 7);
const MONTH_LABEL = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(NOW);

const money = (value: number | null): string => (value === null ? '—' : formatIDR(value));

function MonthlyPnlBody() {
  const { t } = useT();
  const { selected, depots, scopedId } = useDepot();
  const depot = selected ?? depots.find((item) => item.id === scopedId) ?? null;
  const report = useAsync<OperationalMonthlyPnl | null>(
    () =>
      depot
        ? api.get(endpoints.dashboard.monthlyPnl(depot.id, MONTH_KEY), true)
        : Promise.resolve(null),
    [depot?.id],
  );

  if (!depot && !report.loading) {
    return <CenterState title={t('mgrFix.pnl.noDepot')}>{t('mgrFix.pnl.noDepotBody')}</CenterState>;
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChartPieSlice size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('mgrFix.pnl.title')}</h1>
            <p className="text-sm text-muted">
              {t('mgrFix.pnl.subtitle', { depot: depot?.name ?? '', month: MONTH_LABEL })}
            </p>
          </div>
        </div>
        <Badge tone="brand">{t('mgrFix.pnl.operational')}</Badge>
      </div>

      {report.loading ? (
        <Skeleton className="h-80 w-full" />
      ) : report.error ? (
        <ErrorState message={report.error} onRetry={report.reload} />
      ) : report.data ? (
        <PnlReport data={report.data} />
      ) : null}
    </div>
  );
}

function PnlReport({ data }: { data: OperationalMonthlyPnl }) {
  const { t } = useT();
  const partial = data.sources.order === 'unavailable' || data.sources.depot !== 'ok';

  return (
    <>
      {partial && (
        <div className="flex gap-2 rounded-xl bg-[color:var(--warning-bg)] p-3 text-sm text-[color:var(--warning)]" role="status">
          <WarningCircle size={20} weight="fill" className="shrink-0" />
          <span>{t('mgrFix.pnl.partial')}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card elevated className="flex flex-col gap-1 bg-brand-700 p-4 text-on-brand">
          <p className="text-xs font-medium uppercase tracking-wide text-on-brand/70">
            {t('mgrFix.pnl.netOperatingProfit')}
          </p>
          <p className="text-2xl font-bold tabular-nums">{money(data.netOperatingProfitIdr)}</p>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {t('mgrFix.pnl.operatingMargin')}
          </p>
          <p className="text-2xl font-bold tabular-nums">
            {data.marginPct === null ? '—' : `${data.marginPct.toLocaleString('id-ID')}%`}
          </p>
        </Card>
      </div>

      <Card className="flex flex-col px-5 py-2">
        <PnlLine label={t('mgrFix.pnl.revenue')} value={data.revenueIdr} bold border />
        <PnlLine label={t('mgrFix.pnl.cogs')} value={data.cogsIdr} negative indent border />
        <PnlLine label={t('mgrFix.pnl.grossProfit')} value={data.grossProfitIdr} bold border />
        <PnlLine label={t('mgrFix.pnl.opex')} value={data.opexIdr} negative indent border />
        <PnlLine label={t('mgrFix.pnl.netOperatingProfit')} value={data.netOperatingProfitIdr} bold brand />
      </Card>

      <SourceCard data={data} />
      {data.costCoverage?.status === 'partial' && <CoverageCard data={data} />}

      <p className="rounded-xl bg-[color:var(--surface-muted)] px-4 py-3 text-xs text-muted">
        {t('mgrFix.pnl.disclaimer')}
      </p>
    </>
  );
}

function SourceCard({ data }: { data: OperationalMonthlyPnl }) {
  const { t } = useT();
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-bold">{t('mgrFix.pnl.sources')}</h2>
      <SourceRow label={t('mgrFix.pnl.orderSource')} status={data.sources.order} />
      <SourceRow label={t('mgrFix.pnl.costSource')} status={data.sources.depot} />
      {data.opexCoverage && (
        <p className="text-xs text-muted">
          {t('mgrFix.pnl.opexCoverage', {
            included: data.opexCoverage.includedEntries,
            excluded: data.opexCoverage.excludedProcurementEntries,
            unverified: data.opexCoverage.unverifiedProcurementEntries,
          })}
        </p>
      )}
    </Card>
  );
}

function SourceRow({ label, status }: { label: string; status: 'ok' | 'partial' | 'unavailable' }) {
  const { t } = useT();
  const tone = status === 'ok' ? 'success' : status === 'partial' ? 'warning' : 'danger';
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Badge tone={tone}>{t(`mgrFix.pnl.status.${status}`)}</Badge>
    </div>
  );
}

function CoverageCard({ data }: { data: OperationalMonthlyPnl }) {
  const { t } = useT();
  const coverage = data.costCoverage!;
  const percent = coverage.totalUnits === 0 ? 100 : Math.round((coverage.coveredUnits / coverage.totalUnits) * 100);
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-bold">{t('mgrFix.pnl.coverage')}</h2>
        <p className="text-xs text-muted">
          {t('mgrFix.pnl.coverageSummary', {
            covered: coverage.coveredUnits,
            total: coverage.totalUnits,
            percent,
          })}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
        <div className="h-full bg-brand-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-sm">
        {t('mgrFix.pnl.coveredCogs')}: <strong className="tabular-nums">{money(data.coveredCogsIdr)}</strong>
      </p>
      <ul className="space-y-2">
        {coverage.uncoveredItems.map((item) => (
          <li key={`${item.itemId}-${item.reason}`} className="rounded-lg bg-[color:var(--surface-muted)] p-3 text-xs">
            <p className="font-semibold">{item.label} · {t('mgrFix.pnl.units', { n: item.units })}</p>
            <p className="text-muted">{reasonLabel(item.reason, t)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function reasonLabel(reason: OperationalCogsUncoveredReason, t: (key: string) => string): string {
  return t(`mgrFix.pnl.reason.${reason}`);
}

function PnlLine({
  label,
  value,
  bold,
  indent,
  border,
  negative,
  brand,
}: {
  label: string;
  value: number | null;
  bold?: boolean;
  indent?: boolean;
  border?: boolean;
  negative?: boolean;
  brand?: boolean;
}) {
  const valueColor = brand ? 'text-brand-700' : negative ? 'text-[color:var(--danger)]' : '';
  const display = value === null ? '—' : `${negative ? '−' : ''}${formatIDR(value)}`;
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 ${border ? 'border-b border-[color:var(--border)]' : ''}`}>
      <span className={`text-sm ${bold ? 'font-bold' : 'text-muted'} ${indent ? 'pl-3' : ''}`}>{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${bold ? 'font-bold' : ''} ${valueColor}`}>{display}</span>
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
