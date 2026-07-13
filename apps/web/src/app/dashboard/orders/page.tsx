'use client';

import { useState } from 'react';
import { ClipboardText, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { OrderDetail } from '@/components/dashboard/order-detail';
import { Badge, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { statusLabel, tone } from '@/lib/order-status';
import { isStaff } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useAsync } from '@/lib/use-async';
import type { Order, Page } from '@/lib/types';

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'CREATED', label: 'New' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'ON_DELIVERY', label: 'On the way' },
  { value: 'COMPLETED', label: 'Completed' },
];

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

function OrderRow({ order, onOpen }: { order: Order; onOpen: () => void }) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <button type="button" onClick={onOpen} className="flex flex-col gap-2 text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm font-semibold">{order.orderNumber}</p>
            <p className="text-xs text-muted">
              {order.recipientName} · {order.city} · {formatDateTime(order.createdAt)}
            </p>
          </div>
          <Badge tone={TONE_BADGE[tone(order.status)]}>{statusLabel(order.status)}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">
            {order.items.length} item{order.items.length === 1 ? '' : 's'}
          </span>
          <Money amount={order.total} className="font-semibold" />
        </div>
      </button>
    </Card>
  );
}

function QueueBody() {
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);
  const { scopedId, selected: scopedDepot } = useDepot();
  const { data, error, loading, reload } = useAsync<Page<Order>>(
    () =>
      api.get(endpoints.orders.manage({ status: status || undefined, depotId: scopedId ?? undefined, limit: 50 }), true),
    [status, scopedId],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <ClipboardText size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">Order queue</h1>
      </div>

      <p className="text-[12.5px] text-muted">
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

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
              status === f.value
                ? 'bg-brand-600 text-white'
                : 'surface-elevated border border-app hover:bg-brand-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        <CenterState title="No orders here" icon={<ClipboardText size={40} weight="fill" />}>
          Nothing matches this filter right now.
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.items.map((o) => (
            <OrderRow key={o.id} order={o} onOpen={() => setSelected(o)} />
          ))}
        </div>
      )}

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} onChanged={reload} />}
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
