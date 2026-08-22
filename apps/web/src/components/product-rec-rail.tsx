'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Check, Drop, Plus } from '@phosphor-icons/react';

import { RemoteImage } from '@/components/remote-image';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { cartDepotId } from '@/lib/location-store';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useT } from '@/lib/locale-context';
import { useRecommendationPhotos } from '@/lib/product-photos';
import { useAsync } from '@/lib/use-async';
import { SectionHeader } from '@/components/ui';
import type { Cart, Recommendation } from '@/lib/types';

// 1c rec card: mirrors the catalog ProductCard tile, but a Recommendation carries
// no price, so it drops the price/member chip — name, unit, and a round teal add
// button that adds without leaving the grid.
// ponytail: no price because the reorder/trending endpoints don't return one;
// swap to <ProductCard> once recommendations carry basePrice.
function RailCard({ item, imageUrl }: { item: Recommendation; imageUrl?: string | null }) {
  const router = useRouter();
  const { t } = useT();
  const { customer } = useAuth();
  const { bump, apply } = useCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function addToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!customer) {
      router.push(`/login?next=${encodeURIComponent(`/products/detail?id=${item.productId}`)}`);
      return;
    }
    setAdding(true);
    bump(1); // optimistic badge until the server's own cart lands
    try {
      // Audit F-7: POST /cart/items answers with the whole priced cart — adopting it
      // replaces the GET that used to follow every single add.
      apply(await api.post<Cart>(endpoints.cart.items(cartDepotId()), { productId: item.productId, quantity: 1 }, true));
      setAdded(true);
    } catch {
      bump(-1); // roll the badge back on failure
    } finally {
      setAdding(false);
    }
  }

  return (
    <Link
      href={`/products/detail?id=${item.productId}`}
      className="surface group flex flex-col overflow-hidden rounded-[20px] shadow-card transition-[box-shadow,transform] duration-[180ms] hover:-translate-y-[3px] hover:shadow-lift"
    >
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-[color:var(--surface-soft)]">
        {/*
          This drew the placeholder drop UNCONDITIONALLY, so a product's photo could never
          appear on the home page however many were uploaded — it showed only on the detail
          screen and in the /products grid, which both read `imageUrl`. A recommendation
          carries no image (recommendation-service mirrors name/sku/unit only), so the rail
          asks the catalogue for the ones it is about to draw.
        */}
        {imageUrl ? (
          <RemoteImage
            src={imageUrl}
            alt={item.name}
            className="h-full w-full object-cover"
            fallback={<Drop size={56} weight="thin" className="text-brand-300" />}
          />
        ) : (
          <Drop size={56} weight="thin" className="text-brand-300" />
        )}
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
    // Audit F-13: recommendations change when an order is placed, and placing one is a
    // mutation — which drops the cache. Nothing else moves them within a minute.
    () => (canFetch ? api.getCached<Recommendation[]>(endpoint, requiresAuth) : Promise.resolve([])),
    [endpoint, canFetch],
  );

  // The four the rail will actually draw — asked for in ONE call, not one per card, and
  // only once the recommendations are known. A failure here costs the photos, never the
  // rail: the cards fall back to the placeholder they used to always show.
  const shown = (data ?? []).slice(0, 4);
  const imageFor = useRecommendationPhotos(shown);

  if (loading || error || !data || data.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        action={
          <Link
            href="/products"
            className="flex min-h-11 shrink-0 items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700"
          >
            {t('home.rail.viewAll')}
            <ArrowRight size={15} />
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {shown.map((item) => (
          <RailCard key={item.productId} item={item} imageUrl={imageFor.get(item.productId)} />
        ))}
      </div>
    </section>
  );
}
