'use client';

import { useState } from 'react';
import { Info, Lock, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, Money } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());
const PER_DELIVERY = 12000;

type Courier = {
  id: string;
  name: string;
  deliveries: number;
  // COD settlement shortfall to deduct from this period's commission (0 = clean).
  shortfall: number;
};

// TODO: wire to courier-commission backend (no depot-scoped courier commission endpoint;
// payout-service exposes only the courier's own earnings + franchise payout). Static shape.
const COURIERS: Courier[] = [
  { id: 'c1', name: 'Budi Santoso', deliveries: 156, shortfall: 0 },
  { id: 'c2', name: 'Sari Wulandari', deliveries: 142, shortfall: 45000 },
  { id: 'c3', name: 'Dewi Lestari', deliveries: 128, shortfall: 0 },
  { id: 'c4', name: 'Agus Pratama', deliveries: 97, shortfall: 20000 },
];

function net(c: Courier): number {
  return c.deliveries * PER_DELIVERY - c.shortfall;
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function CommissionBody() {
  const [paid, setPaid] = useState(false);
  const total = COURIERS.reduce((sum, c) => sum + net(c), 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Wallet size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Komisi kurir</h1>
          <p className="text-sm text-[color:var(--text-muted)]">periode {MONTH} · siap dibayar</p>
        </div>
      </div>

      <Card elevated className="flex items-center justify-between gap-4 bg-brand-700 p-6 text-on-brand">
        <div>
          <p className="text-sm font-medium text-on-brand/80">Total komisi periode</p>
          <Money amount={total} className="text-2xl font-bold" />
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
        {COURIERS.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
              {initials(c.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{c.name}</p>
              <p className="text-xs text-[color:var(--text-muted)] tabular-nums">
                {c.deliveries} antar × Rp12.000
                {c.shortfall > 0 && ' · selisih setoran'}
              </p>
              {c.shortfall > 0 && (
                <p className="text-xs font-semibold text-[color:var(--warning)] tabular-nums">
                  − potong selisih <Money amount={c.shortfall} />
                </p>
              )}
            </div>
            <Money amount={net(c)} className="shrink-0 font-bold" />
          </div>
        ))}
      </Card>

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
