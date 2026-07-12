'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Check, Drop, Plus } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import { SectionHeader } from '@/components/ui';
import type { Recommendation } from '@/lib/types';

// 1c rec card: mirrors the catalog ProductCard tile, but a Recommendation carries
// no price, so it drops the price/member chip — name, unit, and a round teal add
// button that adds without leaving the grid.
// ponytail: no price because the reorder/trending endpoints don't return one;
// swap to <ProductCard> once recommendations carry basePrice.
function RailCard({ item }: { item: Recommendation }) {
  const router = useRouter();
  const { t } = useT();
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
      className="surface group flex flex-col overflow-hidden rounded-[20px] shadow-card transition-[box-shadow,transform] duration-[180ms] hover:-translate-y-[3px] hover:shadow-lift"
    >
      <div className="flex aspect-square items-center justify-center bg-[color:var(--surface-soft)]">
        <Drop size={56} weight="thin" className="text-brand-300" />
      </div>
      <div className="flex flex-1 flex-col gap-[3px] p-4">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-[1.3]">{item.name}</h3>
        <p className="text-[13px] text-muted">{item.unit}</p>
        <div className="mt-3 flex items-center justify-end">
          <button
            onClick={addToCart}
            disabled={adding}
            aria-label={t('home.rail.addAria', { name: item.name })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-on-brand transition-[background,transform] hover:scale-[1.06] hover:bg-brand-700 disabled:opacity-50"
          >
            {added ? <Check size={18} weight="bold" /> : <Plus size={18} weight="bold" />}
          </button>
        </div>
      </div>
    </Link>
  );
}

/**
 * A titled 4-up grid of recommended products. Purely a discovery surface:
 * renders nothing while loading, on error, or when the list is empty (which also
 * covers signed-out/no-history for `requiresAuth` rails) — never a skeleton or
 * error box blocking the page around it.
 */
export function ProductRecRail({
  title,
  subtitle,
  endpoint,
  requiresAuth,
}: {
  title: string;
  subtitle?: string;
  endpoint: string;
  requiresAuth?: boolean;
}) {
  const { customer } = useAuth();
  const { t } = useT();
  const canFetch = !requiresAuth || !!customer;

  const { data, loading, error } = useAsync<Recommendation[]>(
    () => (canFetch ? api.get<Recommendation[]>(endpoint, requiresAuth) : Promise.resolve([])),
    [endpoint, canFetch],
  );

  if (loading || error || !data || data.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        action={
          <Link
            href="/products"
            className="flex shrink-0 items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700"
          >
            {t('home.rail.viewAll')}
            <ArrowRight size={15} />
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {data.slice(0, 4).map((item) => (
          <RailCard key={item.productId} item={item} />
        ))}
      </div>
    </section>
  );
}
