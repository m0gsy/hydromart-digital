'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Drop, Plus } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useAsync } from '@/lib/use-async';
import { SectionHeader } from '@/components/ui';
import type { Recommendation } from '@/lib/types';

// 1c rec card: Recommendation carries no price, so this drops the price/member
// chip the catalog ProductCard shows — name, unit, and a round teal add button.
function RailCard({ item }: { item: Recommendation }) {
  const router = useRouter();
  const { customer } = useAuth();
  const { bump, refresh } = useCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function addToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!customer) {
      router.push(`/login?next=${encodeURIComponent(`/products/${item.productId}`)}`);
      return;
    }
    setAdding(true);
    bump(1); // optimistic badge; refresh reconciles
    try {
      await api.post(endpoints.cart.items, { productId: item.productId, quantity: 1 }, true);
      setAdded(true);
      await refresh();
    } catch {
      bump(-1); // roll the badge back on failure
    } finally {
      setAdding(false);
    }
  }

  return (
    <Link
      href={`/products/${item.productId}`}
      className="surface group flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-2xl shadow-card transition-[box-shadow,transform] hover:-translate-y-[3px] hover:shadow-lift"
    >
      <div className="flex aspect-square items-center justify-center bg-[color:var(--surface-soft)]">
        <Drop size={48} weight="thin" className="text-brand-300" />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-snug">{item.name}</h3>
        <p className="mt-0.5 text-[13px] text-muted">{item.unit}</p>
        <div className="mt-3 flex items-center justify-end">
          <button
            onClick={addToCart}
            disabled={adding}
            aria-label={`Tambah ${item.name} ke keranjang`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-[background,transform] hover:scale-[1.06] hover:bg-brand-700 disabled:opacity-50"
          >
            {added ? <Check size={18} weight="bold" /> : <Plus size={18} weight="bold" />}
          </button>
        </div>
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
    <section>
      <SectionHeader title={title} />
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1">
        {data.map((item) => (
          <RailCard key={item.productId} item={item} />
        ))}
      </div>
    </section>
  );
}
