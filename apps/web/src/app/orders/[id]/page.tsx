'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, CaretRight, Money as MoneyIcon } from '@phosphor-icons/react';

import { OrderProgress, OrderTimeline } from '@/components/order-views';
import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Money, RadioCard, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { isCancellable, tone } from '@/lib/order-status';
import { PAYMENT_METHODS, needsPayment } from '@/lib/payments';
import { useAsync } from '@/lib/use-async';
import type { Order, OrderStatus, Page, Payment, PaymentMethod } from '@/lib/types';

const PAYMENT_TONE = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
} as const;

// Bahasa status labels for the header chip (statusLabel() is English).
const STATUS_ID: Record<OrderStatus, string> = {
  CREATED: 'Dipesan',
  CONFIRMED: 'Dikonfirmasi',
  PREPARING: 'Disiapkan',
  DRIVER_ASSIGNED: 'Kurir ditugaskan',
  PICKED_UP: 'Diambil kurir',
  ON_DELIVERY: 'Dalam perjalanan',
  DELIVERED: 'Tiba',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

const CHIP_TONE = {
  active: 'bg-brand-50 text-brand-800',
  done: 'bg-[color:var(--success-bg)] text-[color:var(--success)]',
  cancelled: 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]',
} as const;

const CHIP_DOT = {
  active: 'bg-brand-600',
  done: 'bg-[color:var(--success)]',
  cancelled: 'bg-[color:var(--danger)]',
} as const;

function OrderDetailInner({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { data: order, error, loading, reload } = useAsync<Order>(
    () => api.get(endpoints.orders.get(id), true),
    [id],
  );
  const { data: payments, reload: reloadPayments } = useAsync<Page<Payment>>(
    () => api.get(endpoints.payments.forOrder(id), true),
    [id],
  );

  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');

  // Auto-poll while the order is still in flight. Refs keep the latest reloaders
  // without churning the interval; clearInterval on unmount guards state writes.
  const reloadRef = useRef(reload);
  const reloadPaymentsRef = useRef(reloadPayments);
  reloadRef.current = reload;
  reloadPaymentsRef.current = reloadPayments;
  const status = order?.status;
  useEffect(() => {
    if (!status || tone(status) !== 'active') return;
    const t = setInterval(() => {
      reloadRef.current();
      reloadPaymentsRef.current();
    }, 15000);
    return () => clearInterval(t);
  }, [status]);

  async function pay() {
    if (!order) return;
    setAction('pay');
    setActionError(null);
    try {
      await api.post(
        endpoints.payments.initiate,
        { orderId: id, method: payMethod, amount: order.total },
        true,
      );
      reloadPayments();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Tidak bisa memulai pembayaran.');
    } finally {
      setAction(null);
    }
  }

  async function cancel() {
    setAction('cancel');
    setActionError(null);
    try {
      await api.post(endpoints.orders.cancel(id), {}, true);
      reload();
      toast('Pesanan dibatalkan');
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Tidak bisa membatalkan pesanan.');
    } finally {
      setAction(null);
    }
  }

  async function repeat() {
    setAction('repeat');
    setActionError(null);
    try {
      await api.post(endpoints.orders.repeat(id), {}, true);
      toast('Item ditambahkan ke keranjang');
      router.push('/cart');
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Tidak bisa menambahkan item ini lagi.');
      setAction(null);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error || !order) return <ErrorState message={error ?? 'Pesanan tidak ditemukan.'} onRetry={reload} />;

  const payment = payments?.items[0];
  const t = tone(order.status);

  return (
    <div className="flex flex-col gap-5">
      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
        <Link href="/orders" className="transition-colors hover:text-brand-600">
          Pesanan
        </Link>
        <CaretRight size={11} />
        <span className="text-[color:var(--text)]">#{order.orderNumber}</span>
      </div>

      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[30px] font-extrabold tracking-tight">#{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted">
            Dipesan {formatDateTime(order.createdAt)} · {order.items.length} item · Total{' '}
            <Money amount={order.total} className="font-bold text-[color:var(--text)]" />
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-bold ${CHIP_TONE[t]}`}
        >
          <span className={`h-2 w-2 rounded-full ${CHIP_DOT[t]}`} />
          {STATUS_ID[order.status]}
        </span>
      </div>

      {/* tracker */}
      <Card className="p-6">
        <OrderProgress status={order.status} />
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* LEFT */}
        <div className="flex flex-col gap-4">
          {/* items */}
          <Card className="flex flex-col gap-3 p-6">
            <h2 className="text-base font-extrabold">Item</h2>
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <div
                  className="h-[52px] w-[52px] shrink-0 rounded-xl"
                  style={{
                    background:
                      'repeating-linear-gradient(45deg,var(--surface-soft),var(--surface-soft) 8px,var(--surface-muted) 8px,var(--surface-muted) 16px)',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    {item.quantity}× {item.productName}
                  </p>
                  <p className="text-[12.5px] text-muted">{item.unit}</p>
                </div>
                <Money amount={item.lineTotal} className="text-sm font-bold" />
              </div>
            ))}
            <div className="mt-1 flex flex-col gap-2 border-t border-app pt-3 text-[13.5px]">
              <div className="flex justify-between">
                <span className="text-muted">Subtotal</span>
                <Money amount={order.subtotal} className="font-bold" />
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Ongkir</span>
                <Money amount={order.deliveryFee} className="font-bold" />
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Diskon</span>
                  <span className="font-bold text-[color:var(--success)]">
                    −<Money amount={order.discount} />
                  </span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-app pt-3 text-base font-extrabold">
                <span>Total</span>
                <Money amount={order.total} />
              </div>
            </div>
          </Card>

          {/* payment status */}
          {payment && (
            <Card className="flex items-center gap-3 p-6">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50">
                <MoneyIcon size={18} weight="fill" className="text-brand-600" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Pembayaran · {payment.method}</p>
                {payment.instruction && (
                  <p className="text-[12.5px] text-muted">{payment.instruction}</p>
                )}
              </div>
              <Badge tone={PAYMENT_TONE[payment.status]}>{payment.status}</Badge>
            </Card>
          )}

          {/* pay form */}
          {needsPayment(order, payment) && (
            <Card className="flex flex-col gap-3 p-6">
              <div>
                <h2 className="text-base font-extrabold">
                  {payment ? 'Coba bayar lagi' : 'Bayar pesanan ini'}
                </h2>
                <p className="text-sm text-muted">
                  Pilih metode pembayaran untuk{' '}
                  <Money amount={order.total} className="font-bold text-[color:var(--text)]" />.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <RadioCard
                    key={m.value}
                    selected={payMethod === m.value}
                    onSelect={() => setPayMethod(m.value)}
                    className="gap-3 p-3.5"
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                        payMethod === m.value ? 'border-brand-600' : 'border-app'
                      }`}
                    >
                      {payMethod === m.value && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">{m.label}</span>
                      <span className="block text-[12.5px] text-muted">{m.hint}</span>
                    </span>
                  </RadioCard>
                ))}
              </div>
              <Button onClick={pay} loading={action === 'pay'} className="rounded-full">
                Bayar sekarang
              </Button>
            </Card>
          )}

          {/* address */}
          <Card className="flex flex-col gap-1.5 p-6 text-sm">
            <h2 className="text-base font-extrabold">Alamat pengiriman</h2>
            <p className="font-bold">
              {order.recipientName} · {order.phone}
            </p>
            <p className="leading-relaxed text-muted">
              {order.addressLine}, {order.city}, {order.province}
              {order.postalCode ? ` ${order.postalCode}` : ''}
            </p>
            {order.notes && (
              <p className="text-[12.5px] text-muted">
                Catatan: <span className="font-bold text-[color:var(--text)]">{order.notes}</span>
              </p>
            )}
          </Card>

          {actionError && (
            <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
              {actionError}
            </p>
          )}

          {/* actions */}
          <div className="flex flex-wrap gap-3">
            <Button onClick={repeat} loading={action === 'repeat'} className="rounded-full">
              <ArrowsClockwise size={17} weight="bold" />
              Pesan lagi
            </Button>
            {isCancellable(order.status) && (
              <Button
                variant="secondary"
                onClick={cancel}
                loading={action === 'cancel'}
                className="rounded-full hover:border-[color:var(--danger)] hover:text-[color:var(--danger)]"
              >
                Batalkan pesanan
              </Button>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <Card className="p-6">
          <h2 className="mb-4 text-base font-extrabold">Riwayat</h2>
          <OrderTimeline history={order.history} />
        </Card>
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
