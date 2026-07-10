'use client';

import { Badge } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { ORDER_FLOW, statusLabel, statusProgress, tone } from '@/lib/order-status';
import type { OrderStatus, OrderStatusEvent } from '@/lib/types';

const TONE_TO_BADGE = {
  active: 'brand',
  done: 'success',
  cancelled: 'danger',
} as const;

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={TONE_TO_BADGE[tone(status)]}>{statusLabel(status)}</Badge>;
}

/** Horizontal progress rail through the fulfilment flow. */
export function OrderProgress({ status }: { status: OrderStatus }) {
  if (status === 'CANCELLED') return null;
  const pct = Math.round(statusProgress(status) * 100);
  const currentIdx = ORDER_FLOW.indexOf(status);
  return (
    <div className="flex flex-col gap-2">
      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
        <div
          className="h-full rounded-full bg-brand-600 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-muted">
        <span>{statusLabel(ORDER_FLOW[0]!)}</span>
        <span className="font-semibold text-brand-700">
          {statusLabel(ORDER_FLOW[Math.max(0, currentIdx)]!)}
        </span>
        <span>{statusLabel(ORDER_FLOW[ORDER_FLOW.length - 1]!)}</span>
      </div>
    </div>
  );
}

/** Vertical, append-only status history. */
export function OrderTimeline({ history }: { history: OrderStatusEvent[] }) {
  const events = [...history].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return (
    <ol className="flex flex-col gap-4">
      {events.map((event, i) => (
        <li key={`${event.status}-${event.createdAt}`} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`mt-1 h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-brand-600' : 'bg-[color:var(--border)]'}`}
            />
            {i < events.length - 1 && <span className="w-px flex-1 bg-[color:var(--border)]" />}
          </div>
          <div className="flex-1 pb-1">
            <p className="text-sm font-semibold">{statusLabel(event.status)}</p>
            <p className="text-xs text-muted">{formatDateTime(event.createdAt)}</p>
            {event.note && <p className="mt-0.5 text-xs text-muted">{event.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
