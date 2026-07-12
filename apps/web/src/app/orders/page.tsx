'use client';

import Link from 'next/link';
import { Package, CaretRight } from '@phosphor-icons/react';

import { StatusBadge } from '@/components/order-views';
import { ProductRecRail } from '@/components/product-rec-rail';
import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, LinkButton, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Order, Page } from '@/lib/types';

function OrdersInner() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<Page<Order>>(() =>
    api.get(endpoints.orders.list, true),
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || data.items.length === 0) {
    return (
      <CenterState
        icon={<Package size={48} weight="thin" />}
        title={t('order.list.emptyTitle')}
        action={<LinkButton href="/products">{t('order.list.startOrder')}</LinkButton>}
      >
        {t('order.list.emptyBody')}
      </CenterState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t('order.list.title')}</h1>
      <ProductRecRail title={t('order.list.buyAgain')} endpoint={endpoints.recommendations.reorder()} requiresAuth />
      <ul className="flex flex-col gap-3">
        {data.items.map((order) => (
          <li key={order.id}>
            <Link href={`/orders/${order.id}`}>
              <Card className="flex items-center gap-3 p-4 transition-shadow hover:shadow-md">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{order.orderNumber}</span>
                    <StatusBadge status={order.status} />
                  </div>
                  <p className="text-xs text-muted">{formatDateTime(order.createdAt)}</p>
                  <p className="text-xs text-muted">
                    {t(
                      order.items.length === 1
                        ? 'order.list.itemCountOne'
                        : 'order.list.itemCountOther',
                      { n: order.items.length },
                    )}
                  </p>
                </div>
                <div className="text-right font-bold">
                  <Money amount={order.total} />
                </div>
                <CaretRight size={18} className="text-muted" />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <RequireAuth>
      <OrdersInner />
    </RequireAuth>
  );
}
