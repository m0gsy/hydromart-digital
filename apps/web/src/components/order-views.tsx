'use client';

import {
  CheckCircle,
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

function bannerIcon(status: OrderStatus): Icon {
  if (status === 'DELIVERED' || status === 'COMPLETED') return CheckCircle;
  if (status === 'DRIVER_ASSIGNED' || status === 'PICKED_UP' || status === 'ON_DELIVERY') {
    return Truck;
  }
  return Package;
}

/** Stepped node tracker through the fulfilment flow, with a status banner. */
export function OrderProgress({ status }: { status: OrderStatus }) {
  const { t } = useT();
  if (status === 'CANCELLED') {
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-[color:var(--danger-bg)] px-4 py-3">
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
  const BannerIcon = bannerIcon(status);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start">
        {MILESTONES.map((m, i) => {
          const state = completed || i < activePos ? 'done' : i === activePos ? 'active' : 'upcoming';
          const reached = completed || i <= activePos;
          const Ico = m.icon;
          return (
            <div key={m.status} className="relative flex flex-1 flex-col items-center gap-2">
              {i > 0 && (
                <span
                  className={`absolute left-[-50%] right-1/2 top-[19px] h-[3px] ${
                    reached ? 'bg-brand-600' : 'bg-[color:var(--border-soft)]'
                  }`}
                />
              )}
              <span
                className={`relative flex h-10 w-10 items-center justify-center rounded-full ${
                  state === 'upcoming'
                    ? 'bg-[color:var(--surface-soft)] text-muted'
                    : 'bg-brand-600 text-on-brand'
                } ${state === 'active' ? 'ring-4 ring-brand-50' : ''}`}
              >
                <Ico size={17} weight={state === 'upcoming' ? 'regular' : 'fill'} />
              </span>
              <span
                className={`px-0.5 text-center text-[11px] leading-tight sm:text-[12.5px] ${
                  state === 'upcoming' ? 'text-muted' : 'font-bold'
                }`}
              >
                {t(m.labelKey)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2.5 rounded-xl bg-[color:#f2fafb] px-4 py-3.5 dark:bg-brand-50">
        <BannerIcon size={20} weight="fill" className="shrink-0 text-brand-600" />
        <span className="text-sm font-bold">{t(`order.banner.${status}`)}</span>
      </div>
    </div>
  );
}

/* ---------- Status history ---------- */

/** Vertical, append-only status history in the 1c dot-and-line style. */
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
              <span className="mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full bg-[color:var(--border)]" />
            )}
            {i < events.length - 1 && (
              <span className="w-[1.5px] flex-1 bg-[color:var(--border-soft)]" style={{ minHeight: 18 }} />
            )}
          </div>
          <div className="pb-4">
            <p className={`text-sm ${i === 0 ? 'font-bold' : 'font-semibold'}`}>
              {t(`order.status.${event.status}`)}
            </p>
            <p className="mt-0.5 text-xs text-muted">{formatDateTime(event.createdAt)}</p>
            {event.note && <p className="mt-0.5 text-xs font-semibold text-brand-700">{event.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
