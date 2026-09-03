'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Check, Drop, Plus } from '@phosphor-icons/react';

import { RemoteImage } from '@/components/remote-image';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { cartDepotId } from '@/lib/location-store';
import { currentPath, setPendingAdd } from '@/lib/pending-add';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useT } from '@/lib/locale-context';
import { useRecommendationProducts } from '@/lib/product-photos';
import { useAsync } from '@/lib/use-async';
import { SectionHeader } from '@/components/ui';
import type { Cart, Product, Recommendation } from '@/lib/types';

// 1c rec card: mirrors the catalog ProductCard tile, but a Recommendation carries
// no price, so it drops the price/member chip — name, unit, and a round teal add
// button that adds without leaving the grid.
// ponytail: no price because the reorder/trending endpoints don't return one;
// swap to <ProductCard> once recommendations carry basePrice.
/*
 * `product` is the catalogue's own entry for this recommendation, when it has loaded.
 *
 * The NAME comes from it in preference to the recommendation's, because
 * recommendation-service mirrors the name off the order item that last bought the product —
 * a snapshot of the catalogue on the day of that sale. After a rename the rails kept the old
 * name until somebody bought it again, so this card and the product page it links to
 * disagreed. The recommendation's name stays as the fallback for the moment before the
 * catalogue answers, and for a product it no longer carries.
 */
function RailCard({ item, product }: { item: Recommendation; product?: Product }) {
  const name = product?.name ?? item.name;
  const imageUrl = product?.imageUrl;
  const router = useRouter();
  const { t } = useT();
  const { customer } = useAuth();
  const { bump, apply } = useCart();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function addToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!customer) {
      /*
       * CA-3-25. This threw the tap away twice: the chosen product was not remembered, so
       * signing in added nothing; and `next` pointed at the product's DETAIL page, which is
       * not where the guest was. They tapped "+" on the home rail and arrived, signed in,
       * on a page they never asked for with an empty cart.
       *
       * G1 already solved this on `ProductCard` — the same two calls, and now the same
       * behaviour: keep the item, come back HERE.
       */
      setPendingAdd({ productId: item.productId, quantity: 1 });
      router.push(`/login?next=${encodeURIComponent(currentPath())}`);
      return;
    }
    setAdding(true);
    bump(1); // optimistic badge until the server's own cart lands
    try {
      // Audit F-7: POST /cart/items answers with the whole priced cart — adopting it
      // replaces the GET that used to follow every single add.
      apply(
        await api.post<Cart>(
          endpoints.cart.items(cartDepotId()),
          { productId: item.productId, quantity: 1 },
          true,
        ),
      );
      setAdded(true);
    } catch (err) {
      bump(-1); // roll the badge back on failure
      // CA-3-24: a bare catch here too — a failed add was indistinguishable from a missed tap.
      toast(err instanceof ApiError ? err.message : t('shop.pdp.addError'), 'error');
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
            alt={name}
            className="h-full w-full object-cover"
            fallback={<Drop size={56} weight="thin" className="text-brand-300" />}
          />
        ) : (
          <Drop size={56} weight="thin" className="text-brand-300" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-[3px] p-4">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-[1.3]">{name}</h3>
        <p className="text-[13px] text-muted">{item.unit}</p>
        <div className="mt-3 flex items-center justify-end">
          <button
            onClick={addToCart}
            disabled={adding}
            aria-label={t('home.rail.addAria', { name })}
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
    () =>
      canFetch ? api.getCached<Recommendation[]>(endpoint, requiresAuth) : Promise.resolve([]),
    [endpoint, canFetch],
  );

  // The four the rail will actually draw — asked for in ONE call, not one per card, and
  // only once the recommendations are known. A failure here costs the photos, never the
  // rail: the cards fall back to the placeholder they used to always show.
  const shown = (data ?? []).slice(0, 4);
  const productFor = useRecommendationProducts(shown);

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
          <RailCard key={item.productId} item={item} product={productFor.get(item.productId)} />
        ))}
      </div>
    </section>
  );
}
