'use client';

import {
  Check,
  HandDeposit,
  House,
  Package,
  Receipt,
  Truck,
  type Icon,
} from '@phosphor-icons/react';

import { Badge } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { ORDER_FLOW, tone } from '@/lib/order-status';
import type { OrderStatus, OrderStatusEvent } from '@/lib/types';

const TONE_TO_BADGE = {
  active: 'brand',
  done: 'success',
  cancelled: 'danger',
} as const;

/** Compact status badge — consumed by the orders LIST (keep name + props stable). */
export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useT();
  return <Badge tone={TONE_TO_BADGE[tone(status)]}>{t(`order.status.${status}`)}</Badge>;
}

/* ---------- Node progress tracker ---------- */

// Five display milestones mapped onto ORDER_FLOW indices. Statuses between two
// nodes (CONFIRMED, DRIVER_ASSIGNED) fold into the node just before them.
const MILESTONES: { labelKey: string; status: OrderStatus; icon: Icon }[] = [
  { labelKey: 'order.progress.placed', status: 'CREATED', icon: Receipt },
  { labelKey: 'order.progress.prepared', status: 'PREPARING', icon: Package },
  { labelKey: 'order.progress.pickedUp', status: 'PICKED_UP', icon: HandDeposit },
  { labelKey: 'order.progress.onWay', status: 'ON_DELIVERY', icon: Truck },
  { labelKey: 'order.progress.arrived', status: 'DELIVERED', icon: House },
];

/** Stepped node tracker through the fulfilment flow, with a status band. */
export function OrderProgress({
  status,
  driverName,
}: {
  status: OrderStatus;
  driverName?: string | null;
}) {
  const { t } = useT();
  if (status === 'CANCELLED') {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl bg-[color:var(--danger-bg)] px-[18px] py-[14px]">
        <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--danger)]" />
        <span className="text-sm font-bold text-[color:var(--danger)]">
          {t('order.banner.CANCELLED')}
        </span>
      </div>
    );
  }

  const currentIdx = ORDER_FLOW.indexOf(status);
  const completed = status === 'COMPLETED';
  // Active node = last milestone whose status index we have reached.
  const activePos = MILESTONES.reduce(
    (acc, m, i) => (ORDER_FLOW.indexOf(m.status) <= currentIdx ? i : acc),
    0,
  );

  return (
    <div>
      <div className="flex items-start">
        {MILESTONES.map((m, i) => {
          const isDone = completed || i < activePos;
          const isCurrent = !completed && i === activePos;
          // Connector above node i is teal once the previous node is done.
          const prevDone = completed || i - 1 < activePos;
          const Ico = isDone ? Check : m.icon;
          return (
            <div key={m.status} className="relative flex flex-1 flex-col items-center gap-2">
              {i > 0 && (
                <span
                  className={`absolute left-[-50%] right-1/2 top-[19px] h-[2px] ${
                    prevDone ? 'bg-brand-600' : 'bg-[color:var(--border)]'
                  }`}
                />
              )}
              <span
                className={`relative flex h-10 w-10 items-center justify-center rounded-full ${
                  isDone
                    ? 'bg-brand-600 text-on-brand'
                    : isCurrent
                      ? 'bg-[color:var(--text)] text-[color:var(--surface)]'
                      : 'surface border-[1.5px] border-[color:var(--border)] text-muted'
                }`}
              >
                <Ico size={18} weight={isDone || isCurrent ? 'fill' : 'regular'} />
              </span>
              <span
                className={`px-0.5 text-center text-[11px] leading-tight sm:text-[12.5px] ${
                  isDone || isCurrent ? 'font-bold' : 'text-muted'
                }`}
              >
                {t(m.labelKey)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Courier / status band. driverName rides on the order payload once a courier
          is assigned — surface it as a courier card. The customer order payload carries
          NO courier phone or live ETA (deliveries.* is driver/staff-scoped, no customer
          tracking endpoint), so those are omitted rather than fabricated.
          // ponytail: the delivery now snapshots recipientPhone, but that is the CUSTOMER's
          // OWN number — never the driver's, so it must not surface here. Showing the DRIVER's
          // phone needs order-service to snapshot it onto the order at assign (the dispatch UI
          // already has driver.phone) + expose it in the customer order payload. Blocked until then. */}
      {driverName ? (
        <div className="mt-[22px] flex items-center gap-3 rounded-2xl bg-[#f2fafb] px-[18px] py-[14px] dark:bg-brand-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-on-brand">
            <Truck size={18} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{driverName}</p>
            <p className="text-[12.5px] text-muted">{t(`order.banner.${status}`)}</p>
          </div>
        </div>
      ) : (
        <div className="mt-[22px] flex items-center gap-3 rounded-2xl bg-[#f2fafb] px-[18px] py-[14px] dark:bg-brand-50">
          <Truck size={20} weight="fill" className="shrink-0 text-brand-600" />
          <span className="text-sm font-bold">{t(`order.banner.${status}`)}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Status history ---------- */

/** Vertical, append-only status history in the 2e dot-and-line style. */
export function OrderTimeline({ history }: { history: OrderStatusEvent[] }) {
  const { t } = useT();
  const events = [...history].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return (
    <ol className="flex flex-col">
      {events.map((event, i) => (
        <li key={`${event.status}-${event.createdAt}`} className="flex gap-3">
          <div className="flex flex-col items-center">
            {i === 0 ? (
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-brand-600 ring-4 ring-brand-50" />
            ) : (
              <span className="mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full bg-[#d8d4c8] dark:bg-[color:var(--border)]" />
            )}
            {i < events.length - 1 && (
              <span
                className="w-[1.5px] flex-1 bg-[#efece4] dark:bg-[color:var(--border-soft)]"
                style={{ minHeight: 18 }}
              />
            )}
          </div>
          <div className="pb-4">
            <p className={`text-[13.5px] ${i === 0 ? 'font-bold' : 'font-semibold'}`}>
              {t(`order.status.${event.status}`)}
            </p>
            <p className="mt-0.5 text-[12px] text-muted">{formatDateTime(event.createdAt)}</p>
            {event.note && <p className="mt-0.5 text-[12px] font-semibold text-deep-teal">{event.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
