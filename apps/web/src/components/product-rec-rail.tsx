'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Drop, Plus } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { Recommendation } from '@/lib/types';

function RailCard({ item }: { item: Recommendation }) {
  const router = useRouter();
  const { customer } = useAuth();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  // ponytail: same add-to-cart call as the product detail page; no shared cart
  // hook exists yet to extract into, so this mirrors it inline (2 call sites).
  async function addToCart(e: React.MouseEvent) {
    e.preventDefault();
    if (!customer) {
      router.push(`/login?next=${encodeURIComponent(`/products/${item.productId}`)}`);
      return;
    }
    setAdding(true);
    try {
      await api.post(endpoints.cart.items, { productId: item.productId, quantity: 1 }, true);
      setAdded(true);
    } catch {
      // non-blocking discovery surface: swallow, user can retry from the product page
    } finally {
      setAdding(false);
    }
  }

  return (
    <Link
      href={`/products/${item.productId}`}
      className="surface flex w-36 shrink-0 flex-col overflow-hidden rounded-xl border border-app transition-shadow hover:shadow-md"
    >
      <div className="flex aspect-square items-center justify-center bg-[color:var(--surface-muted)]">
        <Drop size={40} weight="thin" className="text-brand-300" />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="line-clamp-2 text-xs font-semibold">{item.name}</h3>
        <p className="text-[11px] text-muted">{item.unit}</p>
        <button
          onClick={addToCart}
          disabled={adding}
          aria-label={`Add ${item.name} to cart`}
          className="mt-auto flex items-center justify-center gap-1 rounded-lg bg-brand-50 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50"
        >
          {added ? <Check size={14} /> : <Plus size={14} />}
          {added ? 'Added' : 'Add'}
        </button>
      </div>
    </Link>
  );
}

/**
 * A titled horizontal-scroll row of recommended products. Purely a discovery
 * surface: renders nothing while loading, on error, or when the list is empty
 * (which also covers signed-out/no-history for `requiresAuth` rails) — never
 * a skeleton or error box blocking the page around it.
 */
export function ProductRecRail({
  title,
  endpoint,
  requiresAuth,
}: {
  title: string;
  endpoint: string;
  requiresAuth?: boolean;
}) {
  const { customer } = useAuth();
  const canFetch = !requiresAuth || !!customer;

  const { data, loading, error } = useAsync<Recommendation[]>(
    () => (canFetch ? api.get<Recommendation[]>(endpoint, requiresAuth) : Promise.resolve([])),
    [endpoint, canFetch],
  );

  if (loading || error || !data || data.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {data.map((item) => (
          <RailCard key={item.productId} item={item} />
        ))}
      </div>
    </section>
  );
}
