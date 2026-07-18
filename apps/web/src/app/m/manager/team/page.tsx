'use client';

import { CenterState, Card, ErrorState, Skeleton } from '@/components/ui';
import { SealCheck, Users } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Customer } from '@/lib/types';

// Real data: the active DRIVER roster (auth.drivers). NOTE: endpoints.deliveries.performance
// returns a SINGLE courier's self-scoped card under the DRIVER-gated /driver path, so a
// manager can't derive a team leaderboard from it. The staff roster is the correct real
// source here. ponytail: per-courier SLA/rating rows need a depot-team metric endpoint that
// does not exist yet — rank by name until it lands.

function initials(name: string | null): string {
  if (!name) return 'K';
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function TeamPage() {
  const { customer } = useAuth();
  const { scopedId } = useDepot();
  const depotId = scopedId ?? customer?.assignedDepotId ?? null;

  const roster = useAsync<Customer[]>(() => api.get(endpoints.auth.drivers, true), []);

  const couriers = (roster.data ?? [])
    .filter((c) => !depotId || c.assignedDepotId === depotId)
    .sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''));
  const activeCount = couriers.filter((c) => c.status === 'ACTIVE').length;

  return (
    <div className="space-y-3 px-4 py-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">Tim kurir</h1>
        <p className="mt-0.5 text-[12.5px] text-[color:var(--text-muted)]">
          Kurir yang ditempatkan di depot kamu.
        </p>
      </header>

      {roster.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : roster.error ? (
        <ErrorState message={roster.error} onRetry={roster.reload} />
      ) : couriers.length === 0 ? (
        <CenterState icon={<Users size={32} />} title="Belum ada kurir">
          Kurir yang ditempatkan di depot ini akan tampil di sini.
        </CenterState>
      ) : (
        <>
          <Card className="flex items-center justify-around p-4">
            <Summary value={String(couriers.length)} label="Total kurir" />
            <div className="h-8 w-px bg-[color:var(--border)]" />
            <Summary value={String(activeCount)} label="Aktif" />
          </Card>

          <div className="space-y-2.5">
            {couriers.map((c, i) => (
              <Card key={c.id} className="flex items-center gap-3 p-3.5">
                <span className="w-5 text-center text-sm font-extrabold tabular-nums text-[color:var(--text-muted)]">
                  {i + 1}
                </span>
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-700 text-xs font-extrabold text-white">
                  {initials(c.fullName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">{c.fullName ?? 'Kurir'}</p>
                  <p className="truncate text-[11px] tabular-nums text-[color:var(--text-muted)]">{c.phone}</p>
                </div>
                {c.status === 'ACTIVE' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-bold text-green-800">
                    <SealCheck size={12} weight="fill" />
                    Aktif
                  </span>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Summary({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}
