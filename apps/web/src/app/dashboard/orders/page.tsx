'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ClipboardText, Lock, Package } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { nextStatus, staffCanAdvance, statusLabel, tone } from '@/lib/order-status';
import { canViewInventory, isStaff } from '@/lib/roles';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { Order, OrderStatus, Page } from '@/lib/types';

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'CREATED', label: 'New' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'ON_DELIVERY', label: 'On the way' },
  { value: 'COMPLETED', label: 'Completed' },
];

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

function OrderRow({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = nextStatus(order.status);
  const canAdvance = staffCanAdvance(order.status) && next;

  async function advance() {
    if (!next) return;
    setAdvancing(true);
    setError(null);
    try {
      await api.patch(endpoints.orders.status(order.id), { status: next }, true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the order.');
      setAdvancing(false);
    }
  }

  return (
    <Card className="flex flex-col gap-2 p-4">
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
      {canAdvance && (
        <div className="flex items-center justify-end gap-2 border-t border-app pt-2">
          <Button variant="secondary" onClick={advance} loading={advancing}>
            Advance to {statusLabel(next as OrderStatus)}
          </Button>
        </div>
      )}
      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

function QueueBody() {
  const { customer } = useAuth();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useAsync<Page<Order>>(
    () => api.get(endpoints.orders.manage({ status: status || undefined, limit: 50 }), true),
    [status],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardText size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Order queue</h1>
        </div>
        {canViewInventory(customer?.role) && (
          <Link
            href="/dashboard/inventory"
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
          >
            <Package size={18} weight="fill" />
            Inventory
          </Link>
        )}
      </div>

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
            <OrderRow key={o.id} order={o} onChanged={reload} />
          ))}
        </div>
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
