'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Drop, Plus } from '@phosphor-icons/react';

import { RemoteImage } from '@/components/remote-image';
import { MemberPrice, Money } from '@/components/ui';
import { haptic } from '@/lib/platform';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { cartDepotId } from '@/lib/location-store';
import { currentPath, setPendingAdd } from '@/lib/pending-add';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useT } from '@/lib/locale-context';
import { memberPrice } from '@/lib/member';
import type { Cart, Product } from '@/lib/types';

// 1c product card: soft-elevated tile, hover-lift, price + member chip, and a
// round teal add-to-cart button that adds without leaving the grid. `memberRate`
// (0 hides the chip) is resolved once by the parent so the grid does one fetch,
// not one per card.

export function ProductCard({
  product,
  memberRate = 0,
  badge,
  depotPrice,
}: {
  product: Product;
  memberRate?: number;
  badge?: string;
  /**
   * PG-03 — what the shopper's own depot charges, when the grid was able to ask. Undefined
   * means the catalogue price is what is shown, and the grid says so above the cards rather
   * than each card pretending to be the depot's.
   */
  depotPrice?: number;
}) {
  const shelfPrice = depotPrice ?? product.basePrice;
  const router = useRouter();
  const { customer } = useAuth();
  const { bump, apply } = useCart();
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function addToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!customer) {
      // G1: keep the item and come back HERE, not to a product page nobody asked for.
      setPendingAdd({ productId: product.id, quantity: 1 });
      router.push(`/login?next=${encodeURIComponent(currentPath())}`);
      return;
    }
    setAdding(true);
    haptic(); // the badge is in the app bar, well away from the thumb that just tapped
    bump(1); // optimistic badge until the server's own cart lands
    try {
      // Audit F-7: POST /cart/items answers with the whole priced cart — adopting it
      // replaces the GET that used to follow every single add.
      apply(await api.post<Cart>(endpoints.cart.items(cartDepotId()), { productId: product.id, quantity: 1 }, true));
      setAdded(true);
    } catch {
      bump(-1); // roll the badge back on failure
    } finally {
      setAdding(false);
    }
  }

  return (
    <Link
      href={`/products/detail?id=${product.id}`}
      className="surface group flex flex-col overflow-hidden rounded-[20px] shadow-card transition-[box-shadow,transform] duration-[180ms] hover:-translate-y-[3px] hover:shadow-lift"
    >
      <div className="relative flex aspect-square items-center justify-center bg-[color:var(--surface-soft)]">
        {product.imageUrl ? (
          // ponytail: plain img (arbitrary depot-supplied URLs). Swap to next/image
          // with a remote allowlist once image hosts are known.
          <RemoteImage
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <Drop size={56} weight="thin" className="text-brand-300" />
        )}
        {badge && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-[color:var(--text)] px-[11px] py-1 text-[11px] font-bold text-[color:var(--surface)]">
            {badge}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-[3px] p-4">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-[1.3]">{product.name}</h3>
        <p className="text-[13px] text-muted">{product.unit}</p>
        {/* A1. `min-w-0` on the price column: a flex child's default `min-width:auto` refuses
            to shrink below its content, and that is what pushed the button clean out of the
            card. `flex-wrap` is the second half — when even the shrunk column plus a 40px
            button will not fit 104px, the button drops to its own line rather than leaving. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            {/* PG-03: the depot's price when the shelf could ask for one, the catalogue
                price otherwise — and the caller labels the grid when it is the latter. */}
            <Money amount={shelfPrice} className="text-[17px] font-extrabold tracking-[-0.01em]" />
            {memberRate > 0 && (
              <MemberPrice amount={memberPrice(shelfPrice, memberRate)} className="px-[9px] py-0.5 text-[11.5px]" />
            )}
          </div>
          <button
            onClick={addToCart}
            disabled={adding}
            aria-label={t('shop.card.addAria', { name: product.name })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-on-brand transition-[background,transform] hover:scale-[1.06] hover:bg-brand-700 disabled:opacity-50"
          >
            {added ? <Check size={18} weight="bold" /> : <Plus size={18} weight="bold" />}
          </button>
        </div>
      </div>
    </Link>
  );
}
