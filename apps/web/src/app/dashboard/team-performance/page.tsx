'use client';

import { ChartBar, Lock, Star } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { formatIDR } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { canViewDashboard } from '@/lib/roles';
import type { Customer, DepotTeamReport, Page } from '@/lib/types';
import { useAsync } from '@/lib/use-async';

const now = new Date();
const MONTH_FROM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
const MONTH_TO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
const AVATAR_COLORS = ['#0b4d57', '#e2681c', '#1d4e89', '#0c97ac', '#6b4ea8'];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style={{ background: color }}
    >
      {initials(name)}
    </span>
  );
}

function TeamPerformanceBody() {
  const { t } = useT();
  const { selected, depots, scopedId } = useDepot();
  const depot = selected ?? depots.find((item) => item.id === scopedId) ?? null;
  const result = useAsync<{ report: DepotTeamReport; names: Map<string, string> } | null>(
    async () => {
      if (!depot) return null;
      const report = await api.get<DepotTeamReport>(
        endpoints.deliveries.depotTeam(depot.id, { from: MONTH_FROM, to: MONTH_TO }),
        true,
      );
      const staff = await api
        .get<Page<Customer>>(endpoints.auth.staff({ depotId: depot.id, limit: 100 }), true)
        .catch(() => null);
      return {
        report,
        names: new Map(staff?.items.map((member) => [member.id, member.fullName || member.phone]) ?? []),
      };
    },
    [depot?.id],
  );

  const report = result.data?.report;
  const names = result.data?.names ?? new Map<string, string>();
  const totalDelivered = report?.couriers.reduce((sum, courier) => sum + courier.delivered, 0) ?? 0;
  const avgSla =
    totalDelivered === 0
      ? 0
      : Math.round(
          (report!.couriers.reduce(
            (sum, courier) => sum + courier.onTimeRate * courier.delivered,
            0,
          ) /
            totalDelivered) *
            100,
        );
  const ratings =
    report?.couriers.flatMap((courier) => (courier.rating === null ? [] : [courier.rating])) ?? [];
  const avgRating =
    ratings.length === 0
      ? null
      : Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ChartBar size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('mgrFix.teamPerf.title')}</h1>
          <p className="text-sm text-muted">
            {t('mgrFix.teamPerf.subtitle', { depot: depot?.name ?? 'Depot' })}
          </p>
        </div>
      </div>

      {result.loading ? (
        <Skeleton className="h-80 w-full" />
      ) : result.error ? (
        <ErrorState message={result.error} onRetry={result.reload} />
      ) : !report || (report.couriers.length === 0 && report.operators.length === 0) ? (
        <CenterState title={t('mgrFix.teamPerf.emptyTitle')} icon={<ChartBar size={40} weight="fill" />}>
          {t('mgrFix.teamPerf.emptyBody')}
        </CenterState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t('mgrFix.teamPerf.avgSla')}
              </p>
              <p className="text-2xl font-bold tabular-nums">{avgSla}%</p>
            </Card>
            <Card className="flex flex-col gap-1 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t('mgrFix.teamPerf.avgRating')}
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {avgRating === null ? '—' : avgRating.toFixed(1)}
              </p>
            </Card>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">
              {t('mgrFix.teamPerf.couriers')}
            </p>
            {report.couriers.length === 0 ? (
              <p className="text-sm text-muted">{t('mgrFix.teamPerf.noCouriers')}</p>
            ) : (
              report.couriers.map((courier, index) => {
                const name = names.get(courier.driverId) ?? courier.driverId;
                const sla = Math.round(courier.onTimeRate * 100);
                return (
                  <Card key={courier.driverId} className="flex items-center gap-3 p-4">
                    <span className="w-5 text-center text-sm font-bold text-brand-600 tabular-nums">
                      {index + 1}
                    </span>
                    <Avatar name={name} color={AVATAR_COLORS[index % AVATAR_COLORS.length]!} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold">{name}</p>
                        {(sla < 90 || courier.failed >= 5) && (
                          <Chip tone="amber">{t('mgrFix.teamPerf.needsAttention')}</Chip>
                        )}
                      </div>
                      <p className="text-xs text-muted">
                        {t('mgrFix.teamPerf.delivered', { n: courier.delivered, sla })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-semibold text-muted">{t('mgrFix.teamPerf.failed')}</p>
                      <p
                        className={`text-sm font-bold tabular-nums ${courier.failed >= 5 ? 'text-[color:var(--danger)]' : ''}`}
                      >
                        {courier.failed}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-semibold text-muted">{t('mgrFix.teamPerf.rating')}</p>
                      <p className="flex items-center justify-end gap-0.5 text-sm font-bold tabular-nums">
                        {courier.rating === null ? '—' : courier.rating.toFixed(1)}
                        {courier.rating !== null && (
                          <Star size={12} weight="fill" className="text-amber-500" />
                        )}
                      </p>
                    </div>
                  </Card>
                );
              })
            )}
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">
              {t('mgrFix.teamPerf.operators')}
            </p>
            {report.operators.length === 0 ? (
              <p className="text-sm text-muted">{t('mgrFix.teamPerf.noOperators')}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {report.operators.map((operator, index) => {
                  const name = names.get(operator.operatorId) ?? operator.operatorId;
                  return (
                    <Card key={operator.operatorId} className="flex flex-col gap-3 p-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={name} color={AVATAR_COLORS[index % AVATAR_COLORS.length]!} />
                        <p className="truncate text-sm font-bold">{name}</p>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted">{t('mgrFix.teamPerf.verifiedSettlements')}</span>
                        <span className="font-bold tabular-nums">{operator.verifiedSettlements}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted">{t('mgrFix.teamPerf.depositVariance')}</span>
                        <span
                          className={`font-bold tabular-nums ${operator.varianceIdr > 0 ? 'text-amber-700' : 'text-[color:var(--success)]'}`}
                        >
                          {formatIDR(operator.varianceIdr)}
                        </span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewDashboard(customer?.role)) {
    return (
      <CenterState title={t('mgrFix.teamPerf.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('mgrFix.teamPerf.gateBody')}
      </CenterState>
    );
  }
  return <TeamPerformanceBody />;
}

export default function TeamPerformancePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
