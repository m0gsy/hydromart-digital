'use client';

import { Buildings, Lock, Truck, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { canViewFranchise } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { FranchiseDashboard } from '@/lib/types';

// Default window: the trailing 30 days. Computed once per mount (client-only).
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function FranchiseBody() {
  const { t } = useT();
  const range = defaultRange();
  const { data, error, loading, reload } = useAsync<FranchiseDashboard>(() =>
    api.get(endpoints.dashboard.franchise(range), true),
  );

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { depots, totals, deliverySla, sources } = data;
  const unavailable = Object.entries(sources)
    .filter(([, v]) => v === 'unavailable')
    .map(([k]) => k);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <Buildings size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">{t('dashboard.franchise.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted">{t('dashboard.franchise.subtitle')}</p>
      </div>

      {/* Headline stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('dashboard.franchise.revenue')}
          value={`Rp ${totals.revenue.toLocaleString('id-ID')}`}
          hint={t('dashboard.franchise.orders', { n: totals.orderCount })}
        />
        <Stat label={t('dashboard.franchise.depots')} value={String(totals.depotCount)} />
        <Stat
          label={t('dashboard.franchise.lowStock')}
          value={String(totals.lowStockCount)}
          hint={totals.lowStockCount > 0 ? t('dashboard.franchise.linesBelowMin') : t('dashboard.franchise.allStocked')}
        />
        <Stat
          label={t('dashboard.franchise.slaOnTime')}
          value={deliverySla ? `${Math.round(deliverySla.slaRate * 100)}%` : '—'}
          hint={deliverySla ? t('dashboard.franchise.delivered', { onTime: deliverySla.onTime, total: deliverySla.totalDelivered }) : undefined}
        />
      </div>

      {unavailable.length > 0 && (
        <p className="text-sm text-amber-700" role="status">
          {t('dashboard.franchise.partial', { which: unavailable.join(', ') })}
        </p>
      )}

      {/* Per-depot breakdown */}
      <Card className="flex flex-col p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Truck size={18} weight="fill" className="text-brand-500" />
          {t('dashboard.franchise.depotsTitle')}
        </h2>
        {depots.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            {sources.depot === 'unavailable'
              ? t('dashboard.franchise.depotDirUnavail')
              : t('dashboard.franchise.noDepots')}
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {depots.map((d) => (
              <li key={d.depotId} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="truncate">{d.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted">{d.code}</span>
                    {!d.active && (
                      <span className="shrink-0 rounded-full bg-[color:var(--surface-muted)] px-2 py-0.5 text-[11px] text-muted">
                        {t('dashboard.franchise.inactive')}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                    <span>{t('dashboard.franchise.ordersCount', { n: d.orderCount })}</span>
                    {d.lowStockCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <Warning size={13} weight="fill" />
                        {t('dashboard.franchise.low', { n: d.lowStockCount })}
                      </span>
                    )}
                  </span>
                </span>
                <Money amount={d.revenue} className="shrink-0 font-medium" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewFranchise(customer?.role)) {
    return (
      <CenterState title={t('dashboard.franchise.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashboard.franchise.gateBody')}
      </CenterState>
    );
  }
  return <FranchiseBody />;
}

export default function FranchisePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
