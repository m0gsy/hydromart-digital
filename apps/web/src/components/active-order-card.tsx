'use client';

import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { Money } from '@/components/ui';
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
    <Link
      href={`/orders/${active.id}`}
      className="surface flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-app px-5 py-3 transition-shadow hover:shadow-card"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--success)] opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[color:var(--success)]" />
      </span>
      <span className="text-sm font-bold text-[color:var(--text)]">
        Pesanan #{active.orderNumber} sedang diantar
      </span>
      <span className="text-[13.5px] text-muted">
        {active.items.length} item · <Money amount={active.total} />
      </span>
      <span className="ml-auto flex items-center gap-1.5 text-sm font-bold text-brand-600">
        Lacak kurir
        <ArrowRight size={15} />
      </span>
    </Link>
  );
}
