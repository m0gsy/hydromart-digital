'use client';

import { useState } from 'react';
import { MagnifyingGlass, Drop } from '@phosphor-icons/react';

import { ProductCard } from '@/components/product-card';
import { ProductRecRail } from '@/components/product-rec-rail';
import { CenterState, ErrorState, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Page, Product } from '@/lib/types';

const LIMIT = 12;

export default function ProductsPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const { data, error, loading, reload } = useAsync<Page<Product>>(
    () => api.get(endpoints.products.browse({ page, limit: LIMIT, search: query || undefined })),
    [page, query],
  );

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Order water</h1>
        <p className="text-sm text-muted">Galon refills and bottled water, delivered from your depot.</p>
      </div>

      {/* `/` redirects straight here, so this doubles as the customer's home screen. */}
      <ProductRecRail title="Buy again" endpoint={endpoints.recommendations.reorder()} requiresAuth />
      <ProductRecRail title="Popular now" endpoint={endpoints.recommendations.trending()} />

      <form onSubmit={submitSearch} className="relative">
        <MagnifyingGlass
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          aria-label="Search products"
          className="pl-10"
        />
      </form>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4]" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        <CenterState icon={<Drop size={48} weight="thin" />} title="No products found">
          {query ? `Nothing matched “${query}”. Try another search.` : 'The catalog is empty right now.'}
        </CenterState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-2 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg px-3 py-1.5 font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-muted">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg px-3 py-1.5 font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
