'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { HandCoins, Package, Storefront, Truck, Warning } from '@phosphor-icons/react';

import { Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';
import { useAsync } from '@/lib/use-async';
import type { CashSettlement, Customer, Delivery, InventoryItem, Order, Page } from '@/lib/types';

// Operator daily summary (design: Depot Operator.dc.html cell 1a "Ringkasan"). The
// operator's landing tab: the things that need action today, all real and depot-scoped —
// order counts + the assign queue, active-courier load, low-stock, and pending COD
// settlements. Everything links out to the tab that acts on it.

const NEEDS_ASSIGN = (o: Order) => o.status === 'PREPARING';
const ACTIVE_DELIVERY: Delivery['status'][] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];

type Summary = {
  orders: Order[];
  needAssign: Order[];
  lowStock: InventoryItem[];
  pending: CashSettlement[];
  activeDrivers: number;
  totalDrivers: number;
};

function todayLabel(): string {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function Stat({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'plain' | 'amber';
}) {
  return (
    <Card
      elevated={false}
      className={`flex flex-col gap-1 p-4 ${tone === 'amber' ? 'border-amber-200 bg-amber-50' : ''}`}
    >
      <p
        className={`text-[11px] font-bold uppercase tracking-wide ${
          tone === 'amber' ? 'text-amber-700' : 'text-[color:var(--text-muted)]'
        }`}
      >
        {label}
      </p>
      <p className={`text-2xl font-extrabold tabular-nums ${tone === 'amber' ? 'text-amber-700' : ''}`}>
        {value}
      </p>
      {hint && <p className="text-[11px] font-medium text-[color:var(--text-muted)]">{hint}</p>}
    </Card>
  );
}

function RingkasanBody({ depotId }: { depotId: string }) {
  const { data, error, loading, reload } = useAsync<Summary>(async () => {
    const [orders, lowStock, pending, drivers, deliveries] = await Promise.all([
      api.get<Page<Order>>(endpoints.orders.manage({ depotId, limit: 100 }), true),
      api.get<InventoryItem[]>(endpoints.inventory.lines(depotId, { lowStockOnly: true }), true),
      api.get<CashSettlement[]>(endpoints.settlements.list({ depotId, status: 'SUBMITTED' }), true),
      api.get<Customer[]>(endpoints.auth.drivers, true),
      api.get<Page<Delivery>>(endpoints.deliveries.list({ limit: 100 }), true),
    ]);
    const busy = new Set(
      deliveries.items.filter((d) => ACTIVE_DELIVERY.includes(d.status)).map((d) => d.driverId),
    );
    return {
      orders: orders.items,
      needAssign: orders.items.filter(NEEDS_ASSIGN),
      lowStock,
      pending,
      activeDrivers: drivers.filter((d) => busy.has(d.id)).length,
      totalDrivers: drivers.length,
    };
  }, [depotId]);

  const codOutstanding = useMemo(
    () => (data?.pending ?? []).reduce((n, s) => n + s.expectedAmount, 0),
    [data],
  );

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">Ringkasan hari ini</h1>
        <p className="text-[12.5px] text-[color:var(--text-muted)]">{todayLabel()}</p>
      </div>

      {/* Headline counters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pesanan masuk" value={data.orders.length} />
        <Stat label="Perlu ditugaskan" value={data.needAssign.length} tone="amber" />
        <Stat
          label="Kurir aktif"
          value={
            <>
              {data.activeDrivers}
              <span className="text-[15px] text-[color:var(--text-muted)]">/{data.totalDrivers}</span>
            </>
          }
        />
        <Stat label="COD belum disetor" value={<Money amount={codOutstanding} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Needs assignment */}
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Perlu ditugaskan</span>
            <Link href="/dashboard/orders" className="text-xs font-bold text-brand-800 hover:underline">
              Lihat antrean
            </Link>
          </div>
          {data.needAssign.length === 0 ? (
            <p className="rounded-xl bg-[color:var(--surface-soft)] p-4 text-center text-sm text-[color:var(--text-muted)]">
              Tidak ada pesanan menunggu penugasan.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.needAssign.slice(0, 3).map((o) => (
                <li
                  key={o.id}
                  className="flex items-center gap-3 rounded-xl border border-app p-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-50">
                    <Package size={18} weight="fill" className="text-brand-800" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12.5px] font-bold tabular-nums">
                      {o.orderNumber}
                    </span>
                    <span className="block truncate text-[11.5px] text-[color:var(--text-muted)]">
                      {o.addressLine}, {o.city} · {o.items.length} item
                    </span>
                  </span>
                  <Link
                    href="/dashboard/orders"
                    className="shrink-0 rounded-[9px] bg-brand-600 px-3 py-2 text-xs font-bold text-on-brand"
                  >
                    Tugaskan
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Low stock + pending settlements */}
        <div className="flex flex-col gap-4">
          <Card elevated={false} className="flex flex-col gap-2 border-red-200 bg-red-50 p-4">
            <div className="flex items-center gap-2">
              <Warning size={18} weight="fill" className="text-red-600" />
              <span className="text-[13.5px] font-bold text-red-800">
                Stok menipis · {data.lowStock.length}
              </span>
            </div>
            {data.lowStock.length === 0 ? (
              <p className="text-xs text-red-800/80">Semua item di atas ambang.</p>
            ) : (
              data.lowStock.slice(0, 3).map((it) => (
                <div key={it.id} className="flex items-center justify-between text-[12.5px]">
                  <span className="font-semibold">{it.label}</span>
                  <span className="font-bold tabular-nums text-red-600">
                    {it.available} / min {it.minimumStock}
                  </span>
                </div>
              ))
            )}
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <HandCoins size={18} weight="fill" className="text-brand-800" />
              <span className="text-[13.5px] font-bold">Setoran menunggu</span>
            </div>
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-[color:var(--text-muted)]">
                {data.pending.length} kurir belum setor
              </span>
              <Money amount={codOutstanding} className="font-bold" />
            </div>
            <Link
              href="/dashboard/settlements"
              className="mt-1 flex h-9 items-center justify-center rounded-[10px] bg-[color:var(--surface-soft)] text-[12.5px] font-bold"
            >
              Verifikasi setoran
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function OperatorRingkasan() {
  const { scopedId } = useDepot();
  if (!scopedId) {
    return (
      <CenterState title="Pilih depot" icon={<Storefront size={40} weight="fill" />}>
        Pilih depot yang kamu kelola untuk melihat ringkasan hari ini.
      </CenterState>
    );
  }
  return <RingkasanBody depotId={scopedId} />;
}
