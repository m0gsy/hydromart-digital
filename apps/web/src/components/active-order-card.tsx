'use client';

import Link from 'next/link';
import { ArrowRight, Package } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { Card, Money } from '@/components/ui';
import { StatusBadge } from '@/components/order-views';
import type { Order, OrderStatus, Page } from '@/lib/types';

// Live status of the customer's most recent in-flight order, surfaced at the top
// of the Home page for returning users. Hides for guests / when nothing is open.

const CLOSED: OrderStatus[] = ['COMPLETED', 'CANCELLED'];

export function ActiveOrderCard() {
  const { customer } = useAuth();

  const { data } = useAsync<Page<Order>>(
    () => (customer ? api.get(endpoints.orders.list, true) : Promise.resolve(null as never)),
    [customer],
  );

  const active = data?.items?.find((o) => !CLOSED.includes(o.status));
  if (!active) return null;

  return (
    <Link href={`/orders/${active.id}`} className="block">
      <Card className="flex items-center gap-4 p-4 transition-shadow hover:shadow-md">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50">
          <Package size={22} weight="fill" className="text-brand-600" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Pesanan #{active.orderNumber}</span>
            <StatusBadge status={active.status} />
          </div>
          <p className="text-sm text-muted">
            {active.items.length} item · <Money amount={active.total} />
          </p>
        </div>
        <ArrowRight size={20} className="shrink-0 text-muted" />
      </Card>
    </Link>
  );
}
