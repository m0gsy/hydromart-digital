'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react';

import { Badge, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { statusLabel, tone } from '@/lib/order-status';
import { useAsync } from '@/lib/use-async';
import type { Order, Page, Payment } from '@/lib/types';

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

// Design 16d — order drill-down: items, timeline, payment & delivery. Real: orders.get
// + payments.forOrderStaff (both staff-readable). Delivery is read off the order itself.
export default function HqOrderDetailPage() {
  const { t } = useT();
  const param = useParams();
  const id = (Array.isArray(param.id) ? param.id[0] : param.id) ?? '';

  const order = useAsync<Order>(() => api.get(endpoints.orders.get(id), true), [id]);
  const payments = useAsync<Page<Payment>>(() => api.get(endpoints.payments.forOrderStaff(id), true), [id]);

  const back = (
    <Link
      href="/hq/orders"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800"
    >
      <ArrowLeft size={16} weight="bold" />
      {t('hq.orderDetail.back')}
    </Link>
  );

  if (order.loading) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (order.error) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <ErrorState message={order.error} onRetry={order.reload} />
      </div>
    );
  }
  const o = order.data;
  if (!o) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <p className="text-sm text-muted">{t('hq.orderDetail.notFound')}</p>
      </div>
    );
  }

  const payment = payments.data?.items[0];

  return (
    <div className="flex flex-col gap-6">
      {back}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{o.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted">{formatDateTime(o.createdAt)}</p>
        </div>
        <Badge tone={TONE_BADGE[tone(o.status)]}>{statusLabel(o.status)}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recipient + items */}
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="mb-1.5 text-sm font-semibold">{t('hq.orderDetail.recipient')}</h2>
            <p className="font-medium">{o.recipientName}</p>
            <p className="text-sm text-muted">{o.phone}</p>
            <p className="text-sm text-muted">
              {o.addressLine}, {o.city}, {o.province}
              {o.postalCode ? ` ${o.postalCode}` : ''}
            </p>
          </div>
          <div>
            <h2 className="mb-1.5 text-sm font-semibold">{t('hq.orderDetail.items')}</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {o.items.map((it) => (
                <li key={it.id} className="flex justify-between gap-3">
                  <span>
                    {it.quantity}× {it.productName}
                  </span>
                  <Money amount={it.lineTotal} className="tabular-nums" />
                </li>
              ))}
            </ul>
            <dl className="mt-2 border-t border-app pt-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{t('hq.orderDetail.subtotal')}</dt>
                <dd><Money amount={o.subtotal} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t('hq.orderDetail.shipping')}</dt>
                <dd><Money amount={o.deliveryFee} /></dd>
              </div>
              {o.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">{t('hq.orderDetail.discount')}</dt>
                  <dd className="text-emerald-700">−<Money amount={o.discount} /></dd>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <dt>{t('hq.orderDetail.total')}</dt>
                <dd><Money amount={o.total} /></dd>
              </div>
            </dl>
          </div>
        </Card>

        {/* Payment + delivery + timeline */}
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="mb-1.5 text-sm font-semibold">{t('hq.orderDetail.payment')}</h2>
            {payments.loading ? (
              <Skeleton className="h-10 w-full" />
            ) : payment ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{payment.method}</span>
                <Badge tone={payment.status === 'PAID' ? 'success' : payment.status === 'PENDING' ? 'warning' : 'neutral'}>
                  {payment.status}
                </Badge>
              </div>
            ) : (
              <p className="text-sm text-muted">{t('hq.orderDetail.noPayment')}</p>
            )}
          </div>
          <div>
            <h2 className="mb-1.5 text-sm font-semibold">{t('hq.orderDetail.delivery')}</h2>
            <p className="text-sm">
              {t('hq.orderDetail.driver')}:{' '}
              <span className="font-medium">{o.driverName || t('hq.orderDetail.noDriver')}</span>
            </p>
          </div>
          {o.history.length > 0 && (
            <div>
              <h2 className="mb-1.5 text-sm font-semibold">{t('hq.orderDetail.timeline')}</h2>
              <ol className="flex flex-col gap-2">
                {o.history.map((h, i) => (
                  <li key={`${h.status}-${i}`} className="flex gap-2.5 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                    <div>
                      <p className="font-medium">{statusLabel(h.status)}</p>
                      <p className="text-xs text-muted">{formatDateTime(h.createdAt)}</p>
                      {h.note && <p className="text-xs text-muted">{h.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
