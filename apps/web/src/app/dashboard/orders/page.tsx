'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardText, Lock, Truck } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { OrderDetail } from '@/components/dashboard/order-detail';
import { Badge, Button, Card, CenterState, ErrorState, ListFooter, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { statusLabel, tone } from '@/lib/order-status';
import { isStaff } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { useAsync } from '@/lib/use-async';
import { usePagedList } from '@/lib/use-paged-list';
import type { Customer, Delivery, Order, Page } from '@/lib/types';

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

// Active-delivery statuses that count toward a courier's current load (mirrors hq/roster).
const ACTIVE_DELIVERY: Delivery['status'][] = ['ASSIGNED', 'PICKED_UP', 'ON_DELIVERY'];

// Two operator groups (design 1b): PREPARING orders are ready for a courier; CREATED/
// CONFIRMED are still being processed (advance them in the order detail sheet first).
const NEEDS_ASSIGN = (o: Order) => o.status === 'PREPARING';
const IN_PROCESS = (o: Order) => o.status === 'CREATED' || o.status === 'CONFIRMED';
/*
 * B8. Half the order lifecycle had no depot screen at all. The queue offered these two
 * groups and nothing else, so the moment a depot assigned a courier the order VANISHED from
 * the only screen the depot has for orders — for the entire half of its life where "where
 * is HM-0042?" is the question actually being asked.
 *
 * Both new groups are read-only by design. Assignment stays PREPARING-only because the
 * state machine allows PREPARING → DRIVER_ASSIGNED and nothing else; a group that offered
 * couriers the server would refuse is the same class of lie this phase exists to close.
 */
const IN_DELIVERY = (o: Order) =>
  o.status === 'DRIVER_ASSIGNED' || o.status === 'PICKED_UP' || o.status === 'ON_DELIVERY' || o.status === 'DELIVERED';
const CLOSED = (o: Order) =>
  o.status === 'COMPLETED' || o.status === 'CANCELLED' || o.status === 'VOIDED';

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
  const { t } = useT();
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
          {order.recipientName} · {order.addressLine}, {order.city} · {t('dashB.orders.itemCount', { n: order.items.length })}
        </p>
      </button>
      <div className="flex flex-col items-end justify-between gap-2 py-4 pr-4">
        <Money amount={order.total} className="text-sm font-semibold" />
        {assignable ? (
          <Button className="px-3 py-1.5" onClick={onSelect}>
            {t('dashB.orders.assign')}
          </Button>
        ) : (
          <Button variant="secondary" className="px-3 py-1.5" onClick={onDetail}>
            {t('dashB.orders.process')}
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
  const { t } = useT();
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
      setAssignError(t('dashB.orders.pickCourierError'));
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
          driverPhone: driver?.phone || undefined,
          depotId: order.depotId ?? undefined,
          destinationAddress: `${order.addressLine}, ${order.city}`,
          destinationLat: order.latitude ?? undefined,
          destinationLng: order.longitude ?? undefined,
          recipientPhone: order.phone,
          items: order.items.map((i) => ({ name: i.productName, qty: i.quantity })),
          // No codAmount: delivery-service reads the payment itself and ignores whatever
          // the client sends. Deciding it here required a staff payment read the two
          // supervisor roles are not granted, so their dispatches went out as non-COD.
          // Snapshot the customer's landmark/note so the courier sees it on the delivery.
          notes: order.notes ?? undefined,
          // B5: and the window they chose, for the same reason — it was stored at checkout,
          // returned by order-service, and reached neither this payload nor any screen.
          deliveryWindow: order.deliveryWindow ?? undefined,
        },
        true,
      );
      onAssigned();
    } catch (err) {
      // Surfaces the "1 kurir = 1 order aktif" DriverBusyError inline.
      setAssignError(err instanceof ApiError ? err.message : t('dashB.orders.assignError'));
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <Card className="p-4">
        <CenterState title={t('dashB.orders.assignCourier')} icon={<Truck size={40} weight="fill" />}>
          {t('dashB.orders.pickOrderHint')}
        </CenterState>
      </Card>
    );
  }

  const picked = drivers.find((d) => d.id === driverId);

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-sm font-semibold">{t('dashB.orders.assignCourier')}</p>
        <p className="font-mono text-sm tabular-nums">{order.orderNumber}</p>
        <p className="text-xs text-[color:var(--text-muted)]">
          {order.addressLine}, {order.city}
        </p>
      </div>

      {!NEEDS_ASSIGN(order) ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-[color:var(--surface-soft)] p-3 text-sm">
          <p className="text-[color:var(--text-muted)]">
            {t('dashB.orders.mustPrepare')}
          </p>
          <Button variant="secondary" onClick={onOpenDetail}>
            {t('dashB.orders.openOrderDetail')}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm font-semibold">{t('dashB.orders.availableCouriers')}</p>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : drivers.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              {t('dashB.orders.noCouriers')}
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
                          {isBusy ? t('dashB.orders.courierBusy', { n: load }) : t('dashB.orders.courierAvailable')}
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
            {t('dashB.orders.oneOrderRule')}
          </div>

          {assignError && (
            <p className="text-sm font-medium text-red-600" role="alert">
              {assignError}
            </p>
          )}

          <Button onClick={assign} loading={busy} disabled={driverId === ''}>
            {picked ? t('dashB.orders.assignTo', { name: picked.fullName || picked.phone }) : t('dashB.orders.assignToCourier')}
          </Button>
        </>
      )}
    </Card>
  );
}

function QueueBody() {
  const { t } = useT();
  const [group, setGroup] = useState<'assign' | 'process' | 'delivery' | 'closed'>('assign');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  // The QUEUE filters, it does not need one depot: `selectedId` (null = every depot the
  // caller may see) is the honest source. `scopedId` falls back to depots[0] for pages
  // that must name a single depot — using it here sent ?depotId=<first depot> while the
  // banner said "Semua depot", so HQ saw one arbitrary depot's queue and called it empty.
  const { selectedId: depotFilterId, selected: scopedDepot } = useDepot();

  /*
   * CA-2-40. The queue read 100 orders and grouped them into four tabs client-side, so on a
   * busy depot the "Antrean" tab was the first hundred orders' worth of work and the rest
   * did not exist — including, on a network-wide view, every order older than the hundredth.
   */
  const queue = usePagedList<Order>(
    (page) =>
      api.get<Page<Order>>(
        endpoints.orders.manage({ depotId: depotFilterId ?? undefined, page, limit: 100 }),
        true,
      ),
    [depotFilterId],
  );
  const { error, loading, reload } = queue;

  /*
   * Active-driver roster joined with live deliveries → real per-courier load (design 1b).
   *
   * CA-2-40, the half that produces a WRONG NUMBER rather than a short list. This counted
   * active deliveries per courier from ONE page of 100, and the operator uses that count to
   * decide who gets the next order: a courier whose deliveries all sat past row 100 read as
   * idle, and the queue handed them more work. So the load is counted over every page, not
   * the first — `fetchAllPages` refuses rather than truncating if the list is ever too large
   * to read, which is the honest failure for a number somebody assigns work by.
   */
  const roster = useAsync<{ drivers: Customer[]; loads: Map<string, number> }>(async () => {
    const [drivers, deliveries] = await Promise.all([
      api.get<Customer[]>(endpoints.auth.drivers, true),
      fetchAllPages<Delivery>(({ page, limit }) =>
        api.get<Page<Delivery>>(endpoints.deliveries.list({ page, limit }), true),
      ),
    ]);
    const loads = new Map<string, number>();
    for (const d of deliveries) {
      if (ACTIVE_DELIVERY.includes(d.status)) loads.set(d.driverId, (loads.get(d.driverId) ?? 0) + 1);
    }
    return { drivers, loads };
  }, []);

  const items = queue.rows;
  const needAssign = useMemo(() => items.filter(NEEDS_ASSIGN), [items]);
  const inProcess = useMemo(() => items.filter(IN_PROCESS), [items]);
  const inDelivery = useMemo(() => items.filter(IN_DELIVERY), [items]);
  const closed = useMemo(() => items.filter(CLOSED), [items]);
  const GROUPS = { assign: needAssign, process: inProcess, delivery: inDelivery, closed };
  const list = GROUPS[group];
  // Assignment itself stays PREPARING-only: the order state machine allows
  // PREPARING → DRIVER_ASSIGNED and nothing else, so a wider "needs assigning" tab would
  // offer couriers the server refuses. The header carries the honest total instead.
  //
  // B8: still the OPEN backlog. An order out with a courier is open work the depot owns,
  // so it counts; a closed one does not, or the badge would only ever grow.
  const backlog = needAssign.length + inProcess.length + inDelivery.length;
  const selected = items.find((o) => o.id === selectedId) ?? null;

  // Land on the group that actually has work. The default tab only holds PREPARING
  // orders, so a depot whose queue is all CREATED/CONFIRMED opened on "Antrean kosong"
  // with orders waiting one tab over. Fires once per load; switching back stays put.
  /*
   * O9 — `?order=<id>` opens that order's detail on arrival. The reconciliation screen
   * links here because the confirm button lives in this detail and nowhere else, and the
   * row it links from is usually NOT in `items`: this queue reads the open backlog, while
   * a row awaiting payment is often already closed. So the id is fetched by itself rather
   * than looked up in whatever page happened to load. Fires once; closing it stays closed.
   */
  const requestedId = useSearchParams().get('order');
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!requestedId || deepLinked.current) return;
    deepLinked.current = true;
    api
      .get<Order>(endpoints.orders.manageGet(requestedId), true)
      .then(setDetailOrder)
      // A bad or forbidden id leaves the queue exactly as it is — the queue is still
      // useful, and an error screen over it would hide the work the operator came for.
      .catch(() => undefined);
  }, [requestedId]);

  const autoGrouped = useRef(false);
  useEffect(() => {
    if (autoGrouped.current || loading) return;
    if (needAssign.length === 0 && inProcess.length > 0) setGroup('process');
    autoGrouped.current = true;
  }, [loading, needAssign.length, inProcess.length]);

  const CHIPS: { value: keyof typeof GROUPS; label: string; count: number }[] = [
    { value: 'assign', label: t('dashB.orders.chipAssign'), count: needAssign.length },
    { value: 'process', label: t('dashB.orders.chipProcess'), count: inProcess.length },
    { value: 'delivery', label: t('dashB.orders.chipDelivery'), count: inDelivery.length },
    { value: 'closed', label: t('dashB.orders.chipClosed'), count: closed.length },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardText size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">{t('dashB.orders.title')}</h1>
        {/* The whole open backlog, not just the assignable slice: CREATED/CONFIRMED are the
            depot's work too, and counting only PREPARING made the queue look shorter than it is. */}
        {/* CA-2-40: and only once every page is in. A backlog counted from part of the
            queue is not a smaller number, it is a wrong one — and this badge is what a
            depot manager reads to decide whether they are on top of the day. */}
        {backlog > 0 && !queue.hasMore && (
          <Badge tone="warning">{t('dashB.orders.backlog', { n: backlog })}</Badge>
        )}
      </div>

      <p className="text-[12.5px] text-[color:var(--text-muted)]">
        {scopedDepot ? (
          <>
            {t('dashB.orders.scopedBefore')}
            <strong className="text-[color:var(--text)]">
              {scopedDepot.name} · {scopedDepot.code}
            </strong>
            {t('dashB.orders.scopedAfter')}
          </>
        ) : (
          t('dashB.orders.allDepots')
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
                className={`min-h-11 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                  group === c.value
                    ? 'bg-brand-600 text-on-brand'
                    : 'surface-elevated border border-app hover:bg-brand-50'
                }`}
              >
                {c.label} · {c.count}
              </button>
            ))}
          </div>

          {loading && items.length === 0 ? (
            <Skeleton className="h-64 w-full" />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : list.length === 0 ? (
            <CenterState title={t('dashB.orders.emptyQueue')} icon={<ClipboardText size={40} weight="fill" />}>
              {group === 'assign'
                ? t('dashB.orders.emptyAssign')
                : t('dashB.orders.emptyProcess')}
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
          {/* The tab counts above are of what has been loaded, and this is the line that
              says how much that is. Without it four confident numbers add up to 100 on a
              depot with 400 open orders. */}
          <ListFooter
            shown={items.length}
            total={queue.total}
            hasMore={queue.hasMore}
            onMore={queue.loadMore}
            loading={loading}
          />
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
  const { t } = useT();
  const { customer } = useAuth();
  if (!isStaff(customer?.role)) {
    return (
      <CenterState title={t('dashB.orders.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashB.orders.gateBody')}
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
