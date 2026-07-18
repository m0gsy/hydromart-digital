'use client';

import { Drop, Info, Lock, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { InventoryWastageSummary } from '@/lib/types';

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());

// Current calendar month window [first-of-month, first-of-next-month).
const now = new Date();
const MONTH_FROM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
const MONTH_TO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

function WastageBody() {
  const { selected, depots, scopedId } = useDepot();
  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? depots[0] ?? null;
  const depotName = depot?.name ?? 'Semua depot';

  const summary = useAsync<InventoryWastageSummary | null>(
    () =>
      depot
        ? api.get(endpoints.inventory.wastage(depot.id, { from: MONTH_FROM, to: MONTH_TO }), true)
        : Promise.resolve(null),
    [depot?.id],
  );

  const data = summary.data;
  const items = data?.byItem ?? [];
  const totalUnits = items.reduce((s, b) => s + b.qty, 0);

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

      {summary.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : summary.error ? (
        <ErrorState message={summary.error} onRetry={summary.reload} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="flex flex-col gap-1 p-5">
              <span className="text-xs text-[color:var(--text-muted)]">Nilai wastage</span>
              <span className="text-3xl font-bold tabular-nums text-[color:var(--danger)]">
                {data?.totalLossIdr != null ? formatIDR(data.totalLossIdr) : '—'}
              </span>
              <span className="text-xs text-[color:var(--text-muted)]">
                {data?.totalLossIdr != null ? 'dari item ber-harga jual' : 'belum ada nilai jual pada item'}
              </span>
            </Card>
            <Card className="flex flex-col gap-1 p-5">
              <span className="text-xs text-[color:var(--text-muted)]">Total unit terbuang</span>
              <span className="text-3xl font-bold tabular-nums">{totalUnits.toLocaleString('id-ID')}</span>
              <span className="text-xs text-[color:var(--text-muted)]">{items.length} jenis item</span>
            </Card>
          </div>

          <Card className="flex flex-col gap-1 p-5">
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <Drop size={18} weight="fill" className="text-brand-500" />
              Rincian
            </h2>
            {items.length === 0 ? (
              <p className="py-3 text-sm text-[color:var(--text-muted)]">
                Belum ada penyusutan (ADJUSTMENT negatif) pada periode ini.
              </p>
            ) : (
              <ul className="divide-y divide-[color:var(--border)]">
                {items.map((b) => (
                  <li key={b.label} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{b.label}</p>
                      <p className="text-xs text-[color:var(--text-muted)]">
                        {b.qty.toLocaleString('id-ID')} unit
                      </p>
                    </div>
                    <span className="shrink-0 font-bold tabular-nums text-[color:var(--danger)]">
                      {b.lossIdr != null ? `−${formatIDR(b.lossIdr)}` : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Info size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <p className="text-[12.5px] text-brand-800/80">
          Setiap wastage tercatat sebagai satu pergerakan inventori bertipe{' '}
          <strong>ADJUSTMENT</strong> dengan delta negatif, sehingga stok dan nilai kerugian selalu
          sinkron dengan buku persediaan. Nilai rupiah hanya muncul untuk item yang punya harga jual.
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
