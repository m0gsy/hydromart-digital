'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';

import { OrderProgress, OrderTimeline, StatusBadge } from '@/components/order-views';
import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { isCancellable } from '@/lib/order-status';
import { useAsync } from '@/lib/use-async';
import type { Order, Page, Payment } from '@/lib/types';

const PAYMENT_TONE = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
} as const;

function OrderDetailInner({ id }: { id: string }) {
  const router = useRouter();
  const { data: order, error, loading, reload } = useAsync<Order>(
    () => api.get(endpoints.orders.get(id), true),
    [id],
  );
  const { data: payments } = useAsync<Page<Payment>>(
    () => api.get(endpoints.payments.forOrder(id), true),
    [id],
  );

  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function cancel() {
    setAction('cancel');
    setActionError(null);
    try {
      await api.post(endpoints.orders.cancel(id), {}, true);
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not cancel the order.');
    } finally {
      setAction(null);
    }
  }

  async function repeat() {
    setAction('repeat');
    setActionError(null);
    try {
      await api.post(endpoints.orders.repeat(id), {}, true);
      router.push('/cart');
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not re-add these items.');
      setAction(null);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error || !order) return <ErrorState message={error ?? 'Order not found.'} onRetry={reload} />;

  const payment = payments?.items[0];

  return (
    <div className="flex flex-col gap-5">
      <Link href="/orders" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
        <ArrowLeft size={16} /> All orders
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{order.orderNumber}</h1>
          <p className="text-sm text-muted">Total <Money amount={order.total} className="font-semibold" /></p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <Card className="p-4">
        <OrderProgress status={order.status} />
      </Card>

      {payment && (
        <Card className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-semibold">Payment · {payment.method}</p>
            {payment.instruction && <p className="text-xs text-muted">{payment.instruction}</p>}
          </div>
          <Badge tone={PAYMENT_TONE[payment.status]}>{payment.status}</Badge>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-semibold">Items</h2>
        {order.items.map((item) => (
          <div key={item.id} className="flex justify-between text-sm">
            <span>
              {item.quantity}× {item.productName}
              <span className="text-muted"> · {item.unit}</span>
            </span>
            <Money amount={item.lineTotal} />
          </div>
        ))}
        <div className="mt-1 border-t border-app pt-3 text-sm">
          <div className="flex justify-between text-muted">
            <span>Subtotal</span>
            <Money amount={order.subtotal} />
          </div>
          <div className="flex justify-between text-muted">
            <span>Delivery fee</span>
            <Money amount={order.deliveryFee} />
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-muted">
              <span>Discount</span>
              <span>
                -<Money amount={order.discount} />
              </span>
            </div>
          )}
          <div className="mt-1 flex justify-between text-base font-bold">
            <span>Total</span>
            <Money amount={order.total} />
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-1 p-4 text-sm">
        <h2 className="font-semibold">Delivery to</h2>
        <p>{order.recipientName} · {order.phone}</p>
        <p className="text-muted">
          {order.addressLine}, {order.city}, {order.province}
          {order.postalCode ? ` ${order.postalCode}` : ''}
        </p>
        {order.notes && <p className="text-muted">Note: {order.notes}</p>}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">Timeline</h2>
        <OrderTimeline history={order.history} />
      </Card>

      {actionError && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {actionError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={repeat} loading={action === 'repeat'}>
          Order again
        </Button>
        {isCancellable(order.status) && (
          <Button variant="danger" onClick={cancel} loading={action === 'cancel'}>
            Cancel order
          </Button>
        )}
      </div>
    </div>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <OrderDetailInner id={id} />
    </RequireAuth>
  );
}
