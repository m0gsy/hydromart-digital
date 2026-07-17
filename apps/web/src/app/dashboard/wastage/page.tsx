'use client';

import { Drop, Info, Lock, TrendDown, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { isDepotManager } from '@/lib/roles';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());

// TODO: derive from a depot-scoped ADJUSTMENT inventory-movements endpoint (none exists yet;
// inventory.movements is per-line only). Each row below is one negative ADJUSTMENT reason.
type Breakdown = { label: string; count: string; loss: string };
const BREAKDOWN: Breakdown[] = [
  { label: 'Galon pecah', count: '14 unit', loss: 'Rp1.120.000' },
  { label: 'Segel gagal pasang', count: '38 unit', loss: 'Rp190.000' },
  { label: 'Air terbuang', count: '9 galon', loss: 'Rp135.000' },
];

function WastageBody() {
  const { selected, depots } = useDepot();
  const depotName = (selected ?? depots[0])?.name ?? 'Semua depot';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Warning size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Wastage</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {depotName} · {MONTH} · dari pergerakan ADJUSTMENT
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-1 p-5">
          <span className="text-xs text-[color:var(--text-muted)]">Nilai wastage</span>
          <span className="text-3xl font-bold tabular-nums text-[color:var(--danger)]">Rp1.445.000</span>
          <span className="text-xs text-[color:var(--text-muted)]">0,4% dari pendapatan</span>
        </Card>
        <Card className="flex flex-col gap-1 p-5">
          <span className="text-xs text-[color:var(--text-muted)]">vs bulan lalu</span>
          <span className="flex items-center gap-1.5 text-3xl font-bold tabular-nums text-[color:var(--success)]">
            <TrendDown size={26} weight="bold" />
            18%
          </span>
          <span className="text-xs text-[color:var(--text-muted)]">membaik</span>
        </Card>
      </div>

      <Card className="flex flex-col gap-1 p-5">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Drop size={18} weight="fill" className="text-brand-500" />
          Rincian
        </h2>
        <ul className="divide-y divide-[color:var(--border)]">
          {BREAKDOWN.map((b) => (
            <li key={b.label} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{b.label}</p>
                <p className="text-xs text-[color:var(--text-muted)]">{b.count}</p>
              </div>
              <span className="shrink-0 font-bold tabular-nums text-[color:var(--danger)]">−{b.loss}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Info size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <p className="text-[12.5px] text-brand-800/80">
          Setiap wastage tercatat sebagai satu pergerakan inventori bertipe{' '}
          <strong>ADJUSTMENT</strong> dengan delta negatif, sehingga stok dan nilai kerugian selalu
          sinkron dengan buku persediaan.
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
        Pelacakan wastage hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <WastageBody />;
}

export default function WastagePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
