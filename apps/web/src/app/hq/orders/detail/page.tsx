'use client';

import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';

import { Badge, Card, ErrorState, LoadError, Money, Skeleton } from '@/components/ui';
import { PaymentSettle, useOrderCourierId } from '@/components/dashboard/order-detail';
import { EntityLink } from '@/components/entity-link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { can } from '@/lib/roles';
import { endpoints } from '@/lib/endpoints';
import { ANONYMOUS_CUSTOMER_ID, entityHref } from '@/lib/entity-href';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { statusLabel, tone } from '@/lib/order-status';
import { canOpenRoute } from '@/lib/route-access';
import { useAsync } from '@/lib/use-async';
import type { Customer, Depot, Order, Page, Payment } from '@/lib/types';
import { useQueryParam } from '@/lib/use-query-param';

const TONE_BADGE = { active: 'brand', done: 'success', cancelled: 'danger' } as const;

/** The buyer's account, for its phone. Never fatal: the name still shows if this fails. */
async function lookupBuyer(id: string): Promise<Customer[] | null> {
  try {
    return await api.getCached<Customer[]>(endpoints.auth.customersByIds([id]), true);
  } catch {
    return null;
  }
}

/**
 * The depot's public record, for its name. Never fatal either. Sent with the session like every
 * staff call (`unauthenticated-calls.test`): a phone build sends no bearer token otherwise.
 */
async function lookupDepot(id: string): Promise<Depot | null> {
  try {
    return await api.getCached<Depot>(endpoints.depots.detail(id), true);
  } catch {
    return null;
  }
}

// Design 16d — order drill-down: items, timeline, payment & delivery. Real: orders.get
// + payments.forOrderStaff (both staff-readable). Delivery is read off the order itself.
export default function HqOrderDetailPage() {
  const { t } = useT();
  const { customer } = useAuth();
  const id = useQueryParam('id');
  // FINANCE holds `refundIssue` and could not reach an order to use it: the order read was
  // `orderQueue`. With `orderManageRead` it can, and the refund starts from here — the same
  // panel the depot console uses, so the reason prompt and the 'above the HQ threshold it is
  // parked for finance' behaviour are one implementation, not two.
  const canRefund = can('refundIssue', customer?.role);

  // Staff read, not the customer one: `orders.get` filters by owner, so HQ always got 404.
  const order = useAsync<Order>(() => api.get(endpoints.orders.manageGet(id), true), [id]);
  const payments = useAsync<Page<Payment>>(
    () => api.get(endpoints.payments.forOrderStaff(id), true),
    [id],
  );

  // PR-2a: the HQ customer screen looks a buyer up by their ACCOUNT phone, and the order only
  // carries the recipient's, which can be anyone's. So the account is resolved first, and only
  // for a role that may both read names and open that screen; anyone else keeps the plain name.
  const role = customer?.role;
  const buyerId = order.data?.customerId;
  // A counter sale without an account carries the anonymous id: nothing to look up.
  const mayResolve =
    buyerId !== ANONYMOUS_CUSTOMER_ID &&
    can('customerNameLookup', role) &&
    canOpenRoute('/hq/customers', role);
  const courierId = useOrderCourierId(
    order.data?.driverName ? order.data.id : undefined,
    '/hr/employees/detail',
    role,
  );
  const buyer = useAsync<Customer[] | null>(
    () => (buyerId && mayResolve ? lookupBuyer(buyerId) : Promise.resolve(null)),
    [buyerId, mayResolve],
  );
  // The depot is named off its public record, read only when there is a door to open.
  const depotId = order.data?.depotId;
  const depotHref = entityHref('depot', depotId, 'hq', role);
  const depot = useAsync<Depot | null>(
    () => (depotHref && depotId ? lookupDepot(depotId) : Promise.resolve(null)),
    [depotHref, depotId],
  );

  const back = (
    <Link
      href="/hq/orders"
      className="tap-44 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800"
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
  const buyerPhone = buyer.data?.find((c) => c.id === o.customerId)?.phone;
  const buyerHref = entityHref('customer', buyerPhone, 'hq', role);

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
            <p className="font-medium">
              {o.recipientName}
              {buyerHref && (
                <>
                  {' · '}
                  <EntityLink href={buyerHref}>
                    {t('opsFix.entityLinks.customerAccount')}
                  </EntityLink>
                </>
              )}
            </p>
            <p className="text-sm text-muted">{o.phone}</p>
            <p className="text-sm text-muted">
              {o.addressLine}, {o.city}
              {o.province ? `, ${o.province}` : ''}
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
                <dd>
                  <Money amount={o.subtotal} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t('hq.orderDetail.shipping')}</dt>
                <dd>
                  <Money amount={o.deliveryFee} />
                </dd>
              </div>
              {o.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">{t('hq.orderDetail.discount')}</dt>
                  <dd className="text-[color:var(--success)]">
                    −<Money amount={o.discount} />
                  </dd>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <dt>{t('hq.orderDetail.total')}</dt>
                <dd>
                  <Money amount={o.total} />
                </dd>
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
            ) : payment && canRefund ? (
              <PaymentSettle order={o} />
            ) : payment ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{payment.method}</span>
                <Badge
                  tone={
                    payment.status === 'PAID'
                      ? 'success'
                      : payment.status === 'PENDING'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {payment.status}
                </Badge>
              </div>
            ) : payments.error ? (
              // "No payment recorded" on an order detail is what a refund decision is made
              // against. An unread payment is not an unpaid one.
              <LoadError onRetry={payments.reload} />
            ) : (
              <p className="text-sm text-muted">{t('hq.orderDetail.noPayment')}</p>
            )}
          </div>
          <div>
            <h2 className="mb-1.5 text-sm font-semibold">{t('hq.orderDetail.delivery')}</h2>
            {depotHref && (
              <p className="text-sm">
                {t('hq.orderDetail.depot')}:{' '}
                <EntityLink href={depotHref}>
                  {depot.data?.name ?? t('hq.orderDetail.openDepot')}
                </EntityLink>
              </p>
            )}
            <p className="text-sm">
              {t('hq.orderDetail.driver')}:{' '}
              <span className="font-medium">
                <EntityLink href={entityHref('courier', courierId, 'hq', role)}>
                  {o.driverName || t('hq.orderDetail.noDriver')}
                </EntityLink>
              </span>
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
