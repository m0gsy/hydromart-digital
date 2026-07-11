'use client';

import { Buildings, Lock, Truck, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
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
          <h1 className="text-2xl font-bold">My franchise</h1>
        </div>
        <p className="mt-1 text-sm text-muted">Last 30 days across the depots you own.</p>
      </div>

      {/* Headline stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={`Rp ${totals.revenue.toLocaleString('id-ID')}`}
          hint={`${totals.orderCount} orders`}
        />
        <Stat label="Depots" value={String(totals.depotCount)} />
        <Stat
          label="Low stock"
          value={String(totals.lowStockCount)}
          hint={totals.lowStockCount > 0 ? 'lines below minimum' : 'all stocked'}
        />
        <Stat
          label="SLA on-time"
          value={deliverySla ? `${Math.round(deliverySla.slaRate * 100)}%` : '—'}
          hint={deliverySla ? `${deliverySla.onTime}/${deliverySla.totalDelivered} delivered` : undefined}
        />
      </div>

      {unavailable.length > 0 && (
        <p className="text-sm text-amber-700" role="status">
          Some data could not be loaded ({unavailable.join(', ')}). Showing what is available.
        </p>
      )}

      {/* Per-depot breakdown */}
      <Card className="flex flex-col p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Truck size={18} weight="fill" className="text-brand-500" />
          Depots
        </h2>
        {depots.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            {sources.depot === 'unavailable'
              ? 'Depot directory unavailable.'
              : 'No depots are assigned to you yet.'}
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
                        inactive
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                    <span>{d.orderCount} orders</span>
                    {d.lowStockCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <Warning size={13} weight="fill" />
                        {d.lowStockCount} low
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
  const { customer } = useAuth();
  if (!canViewFranchise(customer?.role)) {
    return (
      <CenterState title="Franchise owners only" icon={<Lock size={40} weight="fill" />}>
        This dashboard is available to franchise owners.
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
