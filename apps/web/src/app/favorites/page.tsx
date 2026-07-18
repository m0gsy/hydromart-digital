'use client';

import Link from 'next/link';
import { ArrowLeft, Heart } from '@phosphor-icons/react';

import { ProductCard } from '@/components/product-card';
import { RequireAuth } from '@/components/require-auth';
import { ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Product } from '@/lib/types';

// ponytail: inline ID copy (app is ID-primary); wire useT keys when EN parity matters.
// Fetches the id list, then resolves each product. Skips products that 404 (deleted
// but still favorited) so a stale favorite never breaks the whole grid.
function FavoritesInner() {
  const { data, error, loading, reload } = useAsync<Product[]>(async () => {
    const { productIds } = await api.get<{ productIds: string[] }>(endpoints.favorites.list, true);
    if (productIds.length === 0) return [];
    const settled = await Promise.allSettled(
      productIds.map((id) => api.get<Product>(endpoints.products.get(id))),
    );
    return settled
      .filter((r): r is PromiseFulfilledResult<Product> => r.status === 'fulfilled')
      .map((r) => r.value);
  });

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link
          href="/account"
          aria-label="Akun"
          className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-app transition-colors hover:bg-brand-50"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-tight">Favorit</h1>
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
          <p className="text-sm text-muted">Belum ada produk favorit. Ketuk ikon hati di produk untuk menyimpannya.</p>
          <Link
            href="/products"
            className="inline-flex h-11 items-center rounded-xl bg-brand-600 px-6 text-sm font-extrabold text-white transition-colors hover:bg-brand-700"
          >
            Jelajahi produk
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
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
