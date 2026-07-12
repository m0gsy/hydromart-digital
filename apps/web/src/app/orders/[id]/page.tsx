'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, CaretRight, Money as MoneyIcon } from '@phosphor-icons/react';

import { OrderProgress, OrderTimeline } from '@/components/order-views';
import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/toast';
import { Button, ErrorState, Money, RadioCard, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { isCancellable, tone } from '@/lib/order-status';
import { PAYMENT_METHODS, needsPayment } from '@/lib/payments';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Order, Page, Payment, PaymentMethod, PaymentStatus } from '@/lib/types';

// White card in the 2e spec: 22px radius, soft shadow, no border. `surface`
// keeps it theme-aware (white in light, elevated dark surface in dark).
const PANEL = 'surface rounded-[22px] shadow-card';

// Status pill dot colour, keyed off the fulfilment tone.
const DOT = {
  active: 'bg-brand-600',
  done: 'bg-[color:var(--success)]',
  cancelled: 'bg-[color:var(--danger)]',
} as const;

// Payment status badge — PENDING amber per spec (#faf1de / #8a6a1f), the rest
// reuse semantic tokens.
const PAY_BADGE: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-900',
  PAID: 'bg-[color:var(--success-bg)] text-[color:var(--success)]',
  FAILED: 'bg-[color:var(--danger-bg)] text-[color:var(--danger)]',
  CANCELLED: 'bg-[color:var(--surface-soft)] text-muted',
  REFUNDED: 'bg-[color:var(--surface-soft)] text-muted',
};

function OrderDetailInner({ id }: { id: string }) {
  const { t } = useT();
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
      setActionError(e instanceof ApiError ? e.message : t('order.detail.payError'));
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
      toast(t('order.toast.cancelled'));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : t('order.detail.cancelError'));
    } finally {
      setAction(null);
    }
  }

  async function repeat() {
    setAction('repeat');
    setActionError(null);
    try {
      await api.post(endpoints.orders.repeat(id), {}, true);
      toast(t('order.toast.itemsAdded'));
      router.push('/cart');
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : t('order.detail.repeatError'));
      setAction(null);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (error || !order) return <ErrorState message={error ?? t('order.detail.notFound')} onRetry={reload} />;

  const payment = payments?.items[0];
  const toneKey = tone(order.status);

  return (
    <div className="mx-auto flex w-full max-w-[1216px] flex-col gap-4">
      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
        <Link href="/orders" className="transition-colors hover:text-brand-600">
          {t('nav.orders')}
        </Link>
        <CaretRight size={11} weight="bold" />
        <span className="text-[color:var(--text)]">#{order.orderNumber}</span>
      </div>

      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[30px] font-extrabold" style={{ letterSpacing: '-0.03em' }}>
            #{order.orderNumber}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t('order.detail.placedMeta', {
              date: formatDateTime(order.createdAt),
              n: order.items.length,
            })}{' '}
            <Money amount={order.total} className="font-bold text-[color:var(--text)]" />
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-[18px] py-[9px] text-[13.5px] font-extrabold text-brand-800">
          <span className={`h-2 w-2 rounded-full ${DOT[toneKey]}`} />
          {t(`order.status.${order.status}`)}
        </span>
      </div>

      {/* progress stepper */}
      <div className={`${PANEL} px-[30px] py-[26px]`}>
        <OrderProgress status={order.status} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* LEFT */}
        <div className="flex flex-col gap-4">
          {/* items */}
          <div className={`${PANEL} flex flex-col gap-3 p-[22px]`}>
            <h2 className="text-base font-extrabold">{t('order.detail.items')}</h2>
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <div
                  className="h-[52px] w-[52px] shrink-0 rounded-xl"
                  style={{ background: 'var(--surface-muted)' }}
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
            <div className="mt-1 flex flex-col gap-2 border-t border-[color:var(--border-soft)] pt-3 text-[13.5px]">
              <div className="flex justify-between">
                <span className="text-muted">{t('order.detail.subtotal')}</span>
                <Money amount={order.subtotal} className="font-bold" />
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('order.detail.delivery')}</span>
                <Money amount={order.deliveryFee} className="font-bold" />
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">{t('order.detail.discount')}</span>
                  <span className="font-bold text-[color:var(--success)]">
                    −<Money amount={order.discount} />
                  </span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-[color:var(--border-soft)] pt-3 text-[15.5px] font-extrabold">
                <span>{t('order.detail.total')}</span>
                <Money amount={order.total} />
              </div>
            </div>
          </div>

          {/* payment + delivery */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {payment && (
              <div className={`${PANEL} flex items-start gap-3 p-[22px]`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50">
                  <MoneyIcon size={18} weight="fill" className="text-brand-600" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">
                    {t('order.detail.payment')} · {payment.method}
                  </p>
                  {payment.instruction && (
                    <p className="mt-0.5 text-[12.5px] text-muted">{payment.instruction}</p>
                  )}
                  <span
                    className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${PAY_BADGE[payment.status]}`}
                  >
                    {payment.status}
                  </span>
                </div>
              </div>
            )}

            {/* delivery-to */}
            <div className={`${PANEL} flex flex-col gap-1.5 p-[22px] text-sm ${payment ? '' : 'sm:col-span-2'}`}>
              <h2 className="text-base font-extrabold">{t('order.detail.deliveryAddress')}</h2>
              <p className="text-sm font-bold">
                {order.recipientName} · {order.phone}
              </p>
              <p className="leading-relaxed text-muted">
                {order.addressLine}, {order.city}, {order.province}
                {order.postalCode ? ` ${order.postalCode}` : ''}
              </p>
              {order.notes && (
                <p className="text-[12.5px] text-muted">
                  {t('order.detail.notes')}:{' '}
                  <span className="font-bold text-[color:var(--text)]">{order.notes}</span>
                </p>
              )}
            </div>
          </div>

          {/* pay form — kept so a still-unpaid order can be settled (spec omits it,
              but dropping it would regress the payment flow). */}
          {needsPayment(order, payment) && (
            <div className={`${PANEL} flex flex-col gap-3 p-[22px]`}>
              <div>
                <h2 className="text-base font-extrabold">
                  {payment ? t('order.detail.payRetry') : t('order.detail.payTitle')}
                </h2>
                <p className="text-sm text-muted">
                  {t('order.detail.choosePayment')}{' '}
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
                {t('order.detail.payNow')}
              </Button>
            </div>
          )}

          {actionError && (
            <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
              {actionError}
            </p>
          )}

          {/* actions */}
          <div className="flex flex-wrap gap-3">
            <Button onClick={repeat} loading={action === 'repeat'} className="rounded-full">
              <ArrowsClockwise size={17} weight="fill" />
              {t('order.detail.reorder')}
            </Button>
            {isCancellable(order.status) && (
              <Button
                variant="secondary"
                onClick={cancel}
                loading={action === 'cancel'}
                className="rounded-full hover:border-[color:var(--danger)] hover:text-[color:var(--danger)]"
              >
                {t('order.detail.cancel')}
              </Button>
            )}
          </div>
        </div>

        {/* RIGHT — timeline */}
        <div className={`${PANEL} flex flex-col gap-3.5 p-[22px]`}>
          <h2 className="text-base font-extrabold">{t('order.detail.history')}</h2>
          <OrderTimeline history={order.history} />
        </div>
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
