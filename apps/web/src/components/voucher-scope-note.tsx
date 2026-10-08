'use client';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Category, Product } from '@/lib/types';

/*
 * "Khusus Galon 19L": a voucher limited to one product or category says so on its card.
 *
 * Without it a customer holding a scoped code sees a discount that looks like it covers the
 * whole basket, and meets the limit only as a smaller figure (or a refusal) at checkout. The
 * server sends the ids; the name comes from the catalogue. While it loads, or if it cannot be
 * read, the card still says it is limited ("produk tertentu") rather than saying nothing.
 */
export function VoucherScopeNote({
  productId,
  categoryId,
}: {
  productId?: string | null;
  categoryId?: string | null;
}) {
  const { t } = useT();
  const { data: product } = useAsync<Product | null>(
    () => (productId ? api.getCached<Product>(endpoints.products.get(productId)) : Promise.resolve(null)),
    [productId],
  );
  const { data: categories } = useAsync<Category[] | null>(
    () => (!productId && categoryId ? api.getCached<Category[]>(endpoints.products.categories) : Promise.resolve(null)),
    [productId, categoryId],
  );
  if (!productId && !categoryId) return null;

  const name = productId
    ? product?.name
    : Array.isArray(categories)
      ? categories.find((c) => c.id === categoryId)?.name
      : undefined;
  const text = name
    ? t(productId ? 'profile.rewards.wallet.scopedProduct' : 'profile.rewards.wallet.scopedCategory', { name })
    : t('profile.rewards.wallet.scopedGeneric');
  return <div className="mt-0.5 text-[11.5px] font-semibold text-brand-700">{text}</div>;
}
