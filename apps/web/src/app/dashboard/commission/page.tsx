'use client';

import { useState } from 'react';
import { Info, Lock, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { CommissionCourier, CommissionRun, Customer } from '@/lib/types';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());

/** UTC calendar-month window [first-of-month, first-of-next-month), matching the backend. */
function monthWindow(): { from: string; to: string } {
  const n = new Date();
  return {
    from: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString(),
    to: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString(),
  };
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function CourierRow({ c, name }: { c: CommissionCourier; name: string }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{name}</p>
        <p className="text-xs text-[color:var(--text-muted)] tabular-nums">
          {c.delivered} antar × {formatIDR(c.ratePerDeliveryIdr)}
          {c.shortfallIdr > 0 && ' · selisih setoran'}
        </p>
        {c.shortfallIdr > 0 && (
          <p className="text-xs font-semibold text-[color:var(--warning)] tabular-nums">
            − potong selisih <Money amount={c.shortfallIdr} />
          </p>
        )}
      </div>
      <Money amount={c.netIdr} className="shrink-0 font-bold" />
    </div>
  );
}

function CommissionBody() {
  const { scopedId, selected } = useDepot();
  const [paid, setPaid] = useState(false);
  const { from, to } = monthWindow();

  const data = useAsync<{ run: CommissionRun; names: Map<string, string> }>(async () => {
    if (!scopedId) return { run: null as unknown as CommissionRun, names: new Map() };
    const [run, drivers] = await Promise.all([
      api.get<CommissionRun>(endpoints.deliveries.commission(scopedId, { from, to }), true),
      // Names live in auth-service; a failure here just falls back to a short id.
      api.get<Customer[]>(endpoints.auth.drivers, true).catch(() => [] as Customer[]),
    ]);
    const names = new Map(drivers.map((d) => [d.id, d.fullName ?? d.phone]));
    return { run, names };
  }, [scopedId, from, to]);

  const run = data.data?.run ?? null;
  const names = data.data?.names ?? new Map<string, string>();
  const nameOf = (courierId: string) => names.get(courierId) ?? `Kurir ${courierId.slice(0, 8)}`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Wallet size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Komisi kurir</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {selected ? `Depot ${selected.name} · ` : ''}periode {MONTH} · siap dibayar
          </p>
        </div>
      </div>

      {data.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !run || run.couriers.length === 0 ? (
        <CenterState title="Belum ada komisi" icon={<Wallet size={40} weight="fill" />}>
          Belum ada pengantaran terselesaikan untuk depot ini pada periode {MONTH}.
        </CenterState>
      ) : (
        <>
          <Card elevated className="flex items-center justify-between gap-4 bg-brand-700 p-6 text-on-brand">
            <div>
              <p className="text-sm font-medium text-on-brand/80">Total komisi periode</p>
              <Money amount={run.totalIdr} className="text-2xl font-bold" />
            </div>
            <Button
              variant="secondary"
              className="shrink-0 text-brand-800"
              onClick={() => setPaid(true)}
              disabled={paid}
            >
              {paid ? 'Terbayar' : 'Bayar semua'}
            </Button>
          </Card>

          <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
            {run.couriers.map((c) => (
              <CourierRow key={c.courierId} c={c} name={nameOf(c.courierId)} />
            ))}
          </Card>
        </>
      )}

      <Card className="flex items-start gap-3 bg-[color:var(--surface-soft)] p-4">
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-[12.5px] text-[color:var(--text-muted)]">
          Ini komisi per-antar untuk kurir depot Anda — dibayar dari kas depot. Berbeda dari{' '}
          <strong className="text-[color:var(--text)]">bagi hasil franchise</strong>, yang dihitung
          head office dari laba bersih dan dibayar ke pemilik franchise.
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Pembayaran komisi kurir hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <CommissionBody />;
}

export default function CommissionPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
