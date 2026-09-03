'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import { ArrowLeft, Heart } from '@phosphor-icons/react';

import { FavoriteButton } from '@/components/favorite-button';
import { ProductCard } from '@/components/product-card';
import { RequireAuth } from '@/components/require-auth';
import { ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useDepotPrices } from '@/lib/depot-price';
import { useAsync } from '@/lib/use-async';
import type { Product } from '@/lib/types';

// ponytail: inline ID copy (app is ID-primary); wire useT keys when EN parity matters.
// Fetches the id list, then resolves each product. Skips products that 404 (deleted
// but still favorited) so a stale favorite never breaks the whole grid.
function FavoritesInner() {
  const { t } = useT();
  const { data, error, loading, reload } = useAsync<Product[]>(async () => {
    const { productIds } = await api.getCached<{ productIds: string[] }>(
      endpoints.favorites.list,
      true,
    );
    if (productIds.length === 0) return [];
    const settled = await Promise.allSettled(
      productIds.map((id) => api.get<Product>(endpoints.products.get(id))),
    );
    return settled
      .filter((r): r is PromiseFulfilledResult<Product> => r.status === 'fulfilled')
      .map((r) => r.value);
  });

  /*
   * CA-3-08 / CA-3-11. This grid printed `product.basePrice` while the cart billed the
   * depot's own price — the exact PG-03 split, which reached the catalogue and the product
   * page but never these tiles. A shopper who favourited a galon at a depot on a +10% rule
   * read one number here and paid another at the till.
   */
  const shelf = useDepotPrices((data ?? []).map((p) => p.id));

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link
          href="/account"
          aria-label={t('hrFix.favorites.accountAria')}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-app transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-tight">{t('hrFix.favorites.title')}</h1>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-[20px]" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-2xl border border-app p-10 text-center"
          style={{ background: 'var(--surface-muted)' }}
        >
          <Heart size={40} weight="duotone" className="text-brand-400" />
          <p className="text-sm text-muted">{t('hrFix.favorites.empty')}</p>
          <Link
            href="/products"
            className="inline-flex h-11 items-center rounded-xl bg-brand-600 px-6 text-sm font-extrabold text-white transition-colors hover:bg-brand-700"
          >
            Jelajahi produk
          </Link>
        </div>
      ) : (
        <>
          {/* Said once, above the tiles, rather than each tile pretending to be the depot's. */}
          {shelf.basis === 'CATALOG' && shelf.depotKnown && (
            <p className="pb-1 text-xs text-muted">{t('customerFix.checkout.catalogPricing')}</p>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.map((p) => (
              /*
               * H8. A favourite could be added from anywhere and removed from nowhere: this
               * screen drew plain catalogue tiles, so the only way to drop one was to open
               * its detail page and un-heart it there.
               *
               * The heart is a SIBLING of the card, not a child: `ProductCard` is a `Link`,
               * and a button inside it would navigate to the product on every tap. Stacked
               * above it instead, the tap lands on the button and never reaches the link.
               * The row deliberately stays put once un-hearted — the next load drops it,
               * and a tile vanishing under the thumb makes an accidental tap unrecoverable.
               */
              <div key={p.id} className="relative">
                <ProductCard product={p} depotPrice={shelf.prices.get(p.id)} />
                <div className="absolute right-2.5 top-2.5 z-10">
                  <FavoriteButton
                    productId={p.id}
                    className="h-10 w-10 bg-[color:var(--surface)]"
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function FavoritesPage() {
  return (
    <RequireAuth>
      <FavoritesInner />
    </RequireAuth>
  );
}
