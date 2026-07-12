'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Drop, Plus } from '@phosphor-icons/react';

import { MemberPrice, Money } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useT } from '@/lib/locale-context';
import { memberPrice } from '@/lib/member';
import type { Product } from '@/lib/types';

// 1c product card: soft-elevated tile, hover-lift, price + member chip, and a
// round teal add-to-cart button that adds without leaving the grid. `memberRate`
// (0 hides the chip) is resolved once by the parent so the grid does one fetch,
// not one per card.

export function ProductCard({
  product,
  memberRate = 0,
  badge,
}: {
  product: Product;
  memberRate?: number;
  badge?: string;
}) {
  const router = useRouter();
  const { customer } = useAuth();
  const { bump, refresh } = useCart();
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function addToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!customer) {
      router.push(`/login?next=${encodeURIComponent(`/products/${product.id}`)}`);
      return;
    }
    setAdding(true);
    bump(1); // optimistic badge; refresh reconciles
    try {
      await api.post(endpoints.cart.items, { productId: product.id, quantity: 1 }, true);
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
      href={`/products/${product.id}`}
      className="surface group flex flex-col overflow-hidden rounded-2xl shadow-card transition-[box-shadow,transform] hover:-translate-y-[3px] hover:shadow-lift"
    >
      <div className="relative flex aspect-square items-center justify-center bg-[color:var(--surface-soft)]">
        {product.imageUrl ? (
          // ponytail: plain img (arbitrary depot-supplied URLs). Swap to next/image
          // with a remote allowlist once image hosts are known.
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <Drop size={56} weight="thin" className="text-brand-300" />
        )}
        {badge && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-[color:var(--text)] px-2.5 py-1 text-[11px] font-bold text-[color:var(--surface)]">
            {badge}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-4">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-snug">{product.name}</h3>
        <p className="text-[13px] text-muted">{product.unit}</p>
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="flex flex-col gap-1">
            <Money amount={product.basePrice} className="text-[17px] font-extrabold tracking-tight" />
            {memberRate > 0 && (
              <MemberPrice amount={memberPrice(product.basePrice, memberRate)} className="px-2 py-0.5 text-[11.5px]" />
            )}
          </div>
          <button
            onClick={addToCart}
            disabled={adding}
            aria-label={t('shop.card.addAria', { name: product.name })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-[background,transform] hover:scale-[1.06] hover:bg-brand-700 disabled:opacity-50"
          >
            {added ? <Check size={18} weight="bold" /> : <Plus size={18} weight="bold" />}
          </button>
        </div>
      </div>
    </Link>
  );
}
