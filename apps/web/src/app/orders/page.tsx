'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Package, CaretRight } from '@phosphor-icons/react';

import { StatusBadge } from '@/components/order-views';
import { ProductRecRail } from '@/components/product-rec-rail';
import { RequireAuth } from '@/components/require-auth';
import {
  Button,
  Card,
  CenterState,
  ErrorState,
  LinkButton,
  Money,
  Skeleton,
} from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Order, Page } from '@/lib/types';

const PAGE_SIZE = 20;

function OrdersInner() {
  const { t } = useT();
  /*
   * CA-3-27. This read one page and drew it. A customer with more than twenty orders — the
   * subscription customers this business is built around reach that inside a year — simply
   * could not see the twenty-first, and nothing on screen suggested there was one. The
   * endpoint has always paged; the screen never asked.
   *
   * Accumulated by page rather than replaced, so pressing the button never takes away what
   * the reader was already looking at. Same shape as the catalogue grid.
   */
  const [page, setPage] = useState(1);
  const [seen, setSeen] = useState<Record<number, Order[]>>({});
  const { data, error, loading, reload } = useAsync<Page<Order>>(
    () => api.get(endpoints.orders.list({ page, limit: PAGE_SIZE }), true),
    [page],
  );

  useEffect(() => {
    if (data) setSeen((prev) => ({ ...prev, [page]: data.items }));
  }, [data, page]);

  const items = Object.keys(seen)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((n) => seen[n] ?? []);
  const hasMore = data != null && items.length < data.total;

  if (loading && items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  if (error && items.length === 0) return <ErrorState message={error} onRetry={reload} />;
  if (items.length === 0) {
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
      {/* The app bar titles this screen below `sm:`; rendering it here too showed a phone
          the same word twice. */}
      <h1 className="hidden text-2xl font-bold sm:block">{t('order.list.title')}</h1>
      <ProductRecRail
        title={t('order.list.buyAgain')}
        endpoint={endpoints.recommendations.reorder()}
        requiresAuth
      />
      <ul className="flex flex-col gap-3">
        {items.map((order) => (
          <li key={order.id}>
            <Link href={`/orders/detail?id=${order.id}`}>
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
      {hasMore && (
        <div className="flex justify-center pb-6 pt-1">
          <Button
            variant="secondary"
            loading={loading}
            // After a failure the next page is still the one that failed — advancing would
            // skip it silently. Retry the same request instead.
            onClick={error ? reload : () => setPage((p) => p + 1)}
          >
            {t('shop.catalog.loadMore')}
          </Button>
        </div>
      )}
      {error && !loading && <p className="pb-6 text-center text-[13.5px] text-muted">{error}</p>}
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
