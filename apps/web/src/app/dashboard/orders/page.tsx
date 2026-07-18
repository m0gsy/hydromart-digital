'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardText, Lock, Truck } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { OrderDetail } from '@/components/dashboard/order-detail';
import { Badge, Button, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { statusLabel, tone } from '@/lib/order-status';
import { isStaff } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useAsync } from '@/lib/use-async';
import type { Customer, Delivery, Order, Page } from '@/lib/types';

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

// Active-delivery statuses that count toward a courier's current load (mirrors hq/roster).
const ACTIVE_DELIVERY: Delivery['status'][] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];

// Two operator groups (design 1b): PREPARING orders are ready for a courier; CREATED/
// CONFIRMED are still being processed (advance them in the order detail sheet first).
const NEEDS_ASSIGN = (o: Order) => o.status === 'PREPARING';
const IN_PROCESS = (o: Order) => o.status === 'CREATED' || o.status === 'CONFIRMED';

function initials(name: string | null, phone: string) {
  const src = (name || phone || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/* ---------- Left column: the order queue ---------- */
function QueueRow({ order, selected, onSelect, onDetail }: {
  order: Order;
  selected: boolean;
  onSelect: () => void;
  onDetail: () => void;
}) {
  const assignable = NEEDS_ASSIGN(order);
  return (
    <Card
      elevated={false}
      className={`flex items-stretch overflow-hidden ${selected ? 'border-brand-600 ring-1 ring-brand-600' : ''}`}
    >
      <button type="button" onClick={onSelect} className="flex flex-1 flex-col gap-1 p-4 text-left">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums">{order.orderNumber}</span>
          <Badge tone={TONE_BADGE[tone(order.status)]}>{statusLabel(order.status)}</Badge>
        </div>
        <p className="text-xs text-[color:var(--text-muted)]">
          {order.recipientName} · {order.addressLine}, {order.city} · {order.items.length} item
        </p>
      </button>
      <div className="flex flex-col items-end justify-between gap-2 py-4 pr-4">
        <Money amount={order.total} className="text-sm font-semibold" />
        {assignable ? (
          <Button className="px-3 py-1.5" onClick={onSelect}>
            Tugaskan
          </Button>
        ) : (
          <Button variant="secondary" className="px-3 py-1.5" onClick={onDetail}>
            Proses
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ---------- Right column: assign a courier to the selected order ---------- */
function AssignPanel({
  order,
  drivers,
  loads,
  loading,
  error,
  onRetry,
  onAssigned,
  onOpenDetail,
}: {
  order: Order | null;
  drivers: Customer[];
  loads: Map<string, number>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAssigned: () => void;
  onOpenDetail: () => void;
}) {
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Reset the picked courier + error whenever the target order changes.
  useEffect(() => {
    setDriverId('');
    setAssignError(null);
  }, [order?.id]);

  async function assign() {
    if (!order || driverId === '') {
      setAssignError('Pilih kurir yang tersedia.');
      return;
    }
    const driver = drivers.find((d) => d.id === driverId);
    setBusy(true);
    setAssignError(null);
    try {
      await api.post(
        endpoints.deliveries.assign,
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
          driverId,
          driverName: driver?.fullName || undefined,
          depotId: order.depotId ?? undefined,
          destinationAddress: `${order.addressLine}, ${order.city}`,
          destinationLat: order.latitude ?? undefined,
          destinationLng: order.longitude ?? undefined,
        },
        true,
      );
      onAssigned();
    } catch (err) {
      // Surfaces the "1 kurir = 1 order aktif" DriverBusyError inline.
      setAssignError(err instanceof ApiError ? err.message : 'Gagal menugaskan kurir.');
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <Card className="p-4">
        <CenterState title="Tugaskan kurir" icon={<Truck size={40} weight="fill" />}>
          Pilih pesanan dari antrean untuk menugaskan kurir.
        </CenterState>
      </Card>
    );
  }

  const picked = drivers.find((d) => d.id === driverId);

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-sm font-semibold">Tugaskan kurir</p>
        <p className="font-mono text-sm tabular-nums">{order.orderNumber}</p>
        <p className="text-xs text-[color:var(--text-muted)]">
          {order.addressLine}, {order.city}
        </p>
      </div>

      {!NEEDS_ASSIGN(order) ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-[color:var(--surface-soft)] p-3 text-sm">
          <p className="text-[color:var(--text-muted)]">
            Pesanan harus disiapkan (status Preparing) sebelum kurir bisa ditugaskan.
          </p>
          <Button variant="secondary" onClick={onOpenDetail}>
            Buka detail pesanan
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm font-semibold">Kurir tersedia</p>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : drivers.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              Belum ada kurir aktif. Undang kurir di menu Staf &amp; peran.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {drivers.map((d) => {
                const load = loads.get(d.id) ?? 0;
                const isBusy = load > 0;
                const isPicked = driverId === d.id;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-pressed={isPicked}
                      onClick={() => setDriverId(d.id)}
                      className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition-colors ${
                        isBusy
                          ? 'cursor-not-allowed border-app bg-[color:var(--surface-soft)] opacity-70'
                          : isPicked
                            ? 'border-brand-600 bg-brand-50'
                            : 'border-app hover:border-brand-400'
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
                        {initials(d.fullName, d.phone)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{d.fullName || d.phone}</span>
                        <span
                          className={`block text-xs ${
                            isBusy ? 'text-[color:var(--text-muted)]' : 'text-[color:var(--success)]'
                          }`}
                        >
                          {isBusy ? `Sibuk · ${load} tugas aktif` : 'Tersedia · 0 tugas aktif'}
                        </span>
                      </span>
                      {isBusy ? (
                        <Lock size={18} className="shrink-0 text-[color:var(--text-muted)]" />
                      ) : (
                        <span
                          className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                            isPicked ? 'border-brand-600 bg-brand-600' : 'border-app'
                          }`}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="rounded-2xl bg-[color:var(--surface-soft)] p-3 text-xs text-[color:var(--text-muted)]">
            1 kurir hanya boleh 1 order aktif. Kurir sibuk terkunci.
          </div>

          {assignError && (
            <p className="text-sm font-medium text-red-600" role="alert">
              {assignError}
            </p>
          )}

          <Button onClick={assign} loading={busy} disabled={driverId === ''}>
            {picked ? `Tugaskan ke ${picked.fullName || picked.phone}` : 'Tugaskan ke kurir'}
          </Button>
        </>
      )}
    </Card>
  );
}

function QueueBody() {
  const [group, setGroup] = useState<'assign' | 'process'>('assign');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const { scopedId, selected: scopedDepot } = useDepot();

  const { data, error, loading, reload } = useAsync<Page<Order>>(
    () => api.get(endpoints.orders.manage({ depotId: scopedId ?? undefined, limit: 100 }), true),
    [scopedId],
  );

  // Active-driver roster joined with live deliveries → real per-courier load (design 1b).
  const roster = useAsync<{ drivers: Customer[]; loads: Map<string, number> }>(async () => {
    const [drivers, deliveries] = await Promise.all([
      api.get<Customer[]>(endpoints.auth.drivers, true),
      api.get<Page<Delivery>>(endpoints.deliveries.list({ limit: 100 }), true),
    ]);
    const loads = new Map<string, number>();
    for (const d of deliveries.items) {
      if (ACTIVE_DELIVERY.includes(d.status)) loads.set(d.driverId, (loads.get(d.driverId) ?? 0) + 1);
    }
    return { drivers, loads };
  }, []);

  const items = useMemo(() => data?.items ?? [], [data]);
  const needAssign = useMemo(() => items.filter(NEEDS_ASSIGN), [items]);
  const inProcess = useMemo(() => items.filter(IN_PROCESS), [items]);
  const list = group === 'assign' ? needAssign : inProcess;
  const selected = items.find((o) => o.id === selectedId) ?? null;

  const CHIPS: { value: 'assign' | 'process'; label: string; count: number }[] = [
    { value: 'assign', label: 'Perlu ditugaskan', count: needAssign.length },
    { value: 'process', label: 'Diproses', count: inProcess.length },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <ClipboardText size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">Antrean pesanan</h1>
      </div>

      <p className="text-[12.5px] text-[color:var(--text-muted)]">
        {scopedDepot ? (
          <>
            Antrean untuk{' '}
            <strong className="text-[color:var(--text)]">
              {scopedDepot.name} · {scopedDepot.code}
            </strong>{' '}
            (dari switcher).
          </>
        ) : (
          'Semua depot. Pilih satu depot dari switcher untuk memfilter.'
        )}
      </p>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Left: queue */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <button
                key={c.value}
                onClick={() => setGroup(c.value)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                  group === c.value
                    ? 'bg-brand-600 text-on-brand'
                    : 'surface-elevated border border-app hover:bg-brand-50'
                }`}
              >
                {c.label} · {c.count}
              </button>
            ))}
          </div>

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : list.length === 0 ? (
            <CenterState title="Antrean kosong" icon={<ClipboardText size={40} weight="fill" />}>
              {group === 'assign'
                ? 'Tidak ada pesanan yang menunggu penugasan kurir.'
                : 'Tidak ada pesanan yang sedang diproses.'}
            </CenterState>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex min-w-[19rem] flex-col gap-3">
                {list.map((o) => (
                  <QueueRow
                    key={o.id}
                    order={o}
                    selected={selectedId === o.id}
                    onSelect={() => setSelectedId(o.id)}
                    onDetail={() => setDetailOrder(o)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: assign panel */}
        <AssignPanel
          order={selected}
          drivers={roster.data?.drivers ?? []}
          loads={roster.data?.loads ?? new Map()}
          loading={roster.loading}
          error={roster.error}
          onRetry={roster.reload}
          onAssigned={() => {
            setSelectedId(null);
            reload();
            roster.reload();
          }}
          onOpenDetail={() => selected && setDetailOrder(selected)}
        />
      </div>

      {detailOrder && (
        <OrderDetail
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onChanged={() => {
            reload();
            roster.reload();
          }}
        />
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isStaff(customer?.role)) {
    return (
      <CenterState title="Staff access only" icon={<Lock size={40} weight="fill" />}>
        The order queue is available to depot staff.
      </CenterState>
    );
  }
  return <QueueBody />;
}

export default function OrderQueuePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
