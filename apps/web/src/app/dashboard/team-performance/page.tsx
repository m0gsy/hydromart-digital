'use client';

import { ChartBar, Lock, Star, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canViewDashboard } from '@/lib/roles';
import { useT } from '@/lib/locale-context';

// Spec 1b — courier leaderboard (SLA / gagal / rating) + operator throughput.
// ponytail: per-courier SLA/failed/rating and per-operator throughput need a
// cross-service aggregate (delivery-service + payment-service + ratings) that no
// endpoint exposes yet. Render the real UI over representative rows; swap the two
// arrays below for a `/reports/depot-team` fetch once the aggregate ships.
// TODO(backend): GET /orders/api/v1/reports/depot-team?depotId&from&to
type CourierRow = { initials: string; color: string; name: string; delivered: number; sla: number; failed: number; rating: number; watch?: boolean };
type OperatorRow = { initials: string; color: string; name: string; orders: number; variance: string; varianceTone: 'ok' | 'warn' };

const COURIERS: CourierRow[] = [
  { initials: 'AW', color: '#0b4d57', name: 'Andre Wijaya', delivered: 142, sla: 98, failed: 1, rating: 4.9 },
  { initials: 'ST', color: '#e2681c', name: 'Sutrisno', delivered: 118, sla: 95, failed: 3, rating: 4.7 },
  { initials: 'BD', color: '#1d4e89', name: 'Budi Darmawan', delivered: 96, sla: 88, failed: 7, rating: 4.3, watch: true },
];

const OPERATORS: OperatorRow[] = [
  { initials: 'RK', color: '#0c97ac', name: 'Rina Kartika', orders: 312, variance: 'Rp 0', varianceTone: 'ok' },
  { initials: 'DS', color: '#6b4ea8', name: 'Dedi Suryana', orders: 248, variance: 'Rp 6.000', varianceTone: 'warn' },
];

function Avatar({ initials, color }: { initials: string; color: string }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
      style={{ background: color }}
    >
      {initials}
    </span>
  );
}

function TeamPerformanceBody() {
  const { t } = useT();
  const { selected } = useDepot();
  const depotName = selected?.name ?? 'Depot';

  const avgSla = Math.round(COURIERS.reduce((s, c) => s + c.sla, 0) / COURIERS.length);
  const avgRating = (COURIERS.reduce((s, c) => s + c.rating, 0) / COURIERS.length).toFixed(1);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ChartBar size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">{t('mgrFix.teamPerf.title')}</h1>
          <p className="text-sm text-muted">{t('mgrFix.teamPerf.subtitle', { depot: depotName })}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="flex flex-col gap-1 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('mgrFix.teamPerf.avgSla')}</p>
          <p className="text-2xl font-bold tabular-nums">{avgSla}%</p>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('mgrFix.teamPerf.avgRating')}</p>
          <p className="text-2xl font-bold tabular-nums">{avgRating}</p>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('mgrFix.teamPerf.couriers')}</p>
        {COURIERS.map((c, i) => (
          <Card key={c.initials} className="flex items-center gap-3 p-4">
            <span className="w-5 text-center text-sm font-bold text-brand-600 tabular-nums">{i + 1}</span>
            <Avatar initials={c.initials} color={c.color} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-bold">{c.name}</p>
                {c.watch && <Chip tone="amber">{t('mgrFix.teamPerf.needsAttention')}</Chip>}
              </div>
              <p className="text-xs text-muted">{t('mgrFix.teamPerf.delivered', { n: c.delivered, sla: c.sla })}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold text-muted">{t('mgrFix.teamPerf.failed')}</p>
              <p className={`text-sm font-bold tabular-nums ${c.failed >= 5 ? 'text-[color:var(--danger)]' : ''}`}>{c.failed}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold text-muted">{t('mgrFix.teamPerf.rating')}</p>
              <p className="flex items-center justify-end gap-0.5 text-sm font-bold tabular-nums">
                {c.rating.toFixed(1)}
                <Star size={12} weight="fill" className="text-amber-500" />
              </p>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">{t('mgrFix.teamPerf.operators')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {OPERATORS.map((o) => (
            <Card key={o.initials} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <Avatar initials={o.initials} color={o.color} />
                <p className="text-sm font-bold">{o.name}</p>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{t('mgrFix.teamPerf.ordersProcessed')}</span>
                <span className="font-bold tabular-nums">{o.orders.toLocaleString('id-ID')}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{t('mgrFix.teamPerf.depositVariance')}</span>
                <span className={`font-bold tabular-nums ${o.varianceTone === 'warn' ? 'text-amber-700' : 'text-[color:var(--success)]'}`}>
                  {o.variance}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
        <Warning size={15} weight="fill" className="shrink-0" />
        {t('mgrFix.teamPerf.stub')}
      </p>
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
