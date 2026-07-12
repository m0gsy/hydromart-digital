'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MagnifyingGlass, Drop } from '@phosphor-icons/react';

import { ProductCard } from '@/components/product-card';
import { ProductRecRail } from '@/components/product-rec-rail';
import { Button, CenterState, ErrorState, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Category, Page, Product } from '@/lib/types';

const LIMIT = 12;

function ProductsCatalog() {
  const router = useRouter();
  const params = useSearchParams();

  // URL is the source of truth so searches/category filters are shareable and
  // deep-linkable (the Home hero + category tiles navigate here with params).
  const query = params.get('search')?.trim() ?? '';
  const categoryId = params.get('category') ?? '';

  const [search, setSearch] = useState(query);
  const [page, setPage] = useState(1);

  // Reset paging + sync the input when the URL filters change.
  useEffect(() => {
    setPage(1);
    setSearch(query);
  }, [query, categoryId]);

  const categories = useAsync<Category[]>(() => api.get<Category[]>(endpoints.products.categories), []);
  const activeCategory = useMemo(
    () => categories.data?.find((c) => c.id === categoryId) ?? null,
    [categories.data, categoryId],
  );

  const { data, error, loading, reload } = useAsync<Page<Product>>(
    () =>
      api.get(
        endpoints.products.browse({
          page,
          limit: LIMIT,
          search: query || undefined,
          categoryId: categoryId || undefined,
        }),
      ),
    [page, query, categoryId],
  );

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    const p = new URLSearchParams();
    if (q) p.set('search', q);
    if (categoryId) p.set('category', categoryId);
    router.push(`/products${p.toString() ? `?${p.toString()}` : ''}`);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;
  const empty = !data || data.items.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{activeCategory ? activeCategory.name : 'Pesan air'}</h1>
        <p className="text-sm text-muted">Galon isi ulang dan air botol, diantar dari depot Anda.</p>
      </div>

      {/* Category chips — quick filter + a way out of a zero-result state. */}
      {(categories.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/products"
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              categoryId ? 'border-app hover:bg-brand-50' : 'border-brand-600 bg-brand-50 text-brand-700'
            }`}
          >
            Semua
          </Link>
          {categories.data!.map((c) => (
            <Link
              key={c.id}
              href={`/products?category=${c.id}`}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                c.id === categoryId
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-app hover:bg-brand-50'
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <form onSubmit={submitSearch} className="relative">
        <MagnifyingGlass
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari produk…"
          aria-label="Cari produk"
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
      ) : empty ? (
        <EmptyState query={query} category={activeCategory?.name ?? (categoryId ? '' : null)} />
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
                Sebelumnya
              </button>
              <span className="text-muted">
                Halaman {page} dari {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg px-3 py-1.5 font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40"
              >
                Berikutnya
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Meaningful empty states with a clear next action — never a dead end.
// `category`: name string when a category filter is active, '' when the
// filtered category is unknown, null when no category filter.
function EmptyState({ query, category }: { query: string; category: string | null }) {
  if (query) {
    return (
      <div className="flex flex-col gap-4">
        <CenterState
          icon={<Drop size={48} weight="thin" />}
          title={`Tidak ada hasil untuk “${query}”`}
          action={<LinkButtonHome />}
        >
          Coba kata kunci lain, atau lihat produk terlaris di bawah.
        </CenterState>
        {/* Fallback discovery surface so the search dead-end still offers a path forward. */}
        <ProductRecRail title="Terlaris" endpoint={endpoints.recommendations.trending()} />
      </div>
    );
  }
  if (category !== null) {
    return (
      <CenterState
        icon={<Drop size={48} weight="thin" />}
        title={category ? `Belum ada produk di “${category}”` : 'Belum ada produk di kategori ini'}
        action={<LinkButtonHome label="Lihat semua produk" href="/products" />}
      >
        Stok kategori ini sedang disiapkan. Coba kategori lain.
      </CenterState>
    );
  }
  return (
    <CenterState
      icon={<Drop size={48} weight="thin" />}
      title="Katalog sedang diisi"
      action={<LinkButtonHome label="Kembali ke beranda" href="/" />}
    >
      Produk akan segera tersedia. Kembali lagi sebentar lagi.
    </CenterState>
  );
}

function LinkButtonHome({ label = 'Bersihkan pencarian', href = '/products' }: { label?: string; href?: string }) {
  return (
    <Link href={href}>
      <Button variant="secondary">{label}</Button>
    </Link>
  );
}

export default function ProductsPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <ProductsCatalog />
    </Suspense>
  );
}
