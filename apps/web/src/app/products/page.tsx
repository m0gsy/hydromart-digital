'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MagnifyingGlass, Drop, CaretLeft, CaretRight } from '@phosphor-icons/react';

import { ProductCard } from '@/components/product-card';
import { ProductRecRail } from '@/components/product-rec-rail';
import { Button, CenterState, ErrorState, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useMemberRate } from '@/lib/member';
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

  // One loyalty fetch for the whole grid; passed to every card.
  const memberRate = useMemberRate();

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
      {/* Header + search pill — one row on desktop, stacked on mobile. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[30px] font-extrabold leading-none tracking-tight text-[color:var(--text)]">
            {activeCategory ? activeCategory.name : 'Pesan air'}
          </h1>
          <p className="text-sm text-muted">Galon isi ulang dan air botol, diantar dari depot Anda.</p>
        </div>
        <form onSubmit={submitSearch} className="relative w-full sm:w-[380px]">
          <MagnifyingGlass
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-brand-600"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari produk…"
            aria-label="Cari produk"
            className="surface h-12 !rounded-full border-app pl-11 pr-5"
          />
        </form>
      </div>

      {/* Category pills — quick filter + a way out of a zero-result state. */}
      {(categories.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2.5">
          <Link
            href="/products"
            className={`rounded-full px-[18px] py-2 text-sm font-bold transition-colors ${
              categoryId
                ? 'surface border border-app text-muted hover:border-brand-600'
                : 'bg-[color:var(--text)] text-[color:var(--surface)]'
            }`}
          >
            Semua
          </Link>
          {categories.data!.map((c) => (
            <Link
              key={c.id}
              href={`/products?category=${c.id}`}
              className={`rounded-full px-[18px] py-2 text-sm font-bold transition-colors ${
                c.id === categoryId
                  ? 'bg-[color:var(--text)] text-[color:var(--surface)]'
                  : 'surface border border-app text-muted hover:border-brand-600'
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : empty ? (
        <EmptyState query={query} category={activeCategory?.name ?? (categoryId ? '' : null)} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((product) => (
              <ProductCard key={product.id} product={product} memberRate={memberRate} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <PageButton
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Halaman sebelumnya"
              >
                <CaretLeft size={15} weight="bold" />
              </PageButton>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <PageButton key={n} onClick={() => setPage(n)} active={n === page} aria-label={`Halaman ${n}`}>
                  {n}
                </PageButton>
              ))}
              <PageButton
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Halaman berikutnya"
              >
                <CaretRight size={15} weight="bold" />
              </PageButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Round 38px pagination control — filled ink when active, bordered otherwise.
function PageButton({
  active = false,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...rest}
      className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-[13.5px] font-bold transition-colors disabled:opacity-40 ${
        active
          ? 'bg-[color:var(--text)] font-extrabold text-[color:var(--surface)]'
          : 'surface border border-app text-muted hover:border-brand-600 disabled:hover:border-app'
      }`}
    >
      {children}
    </button>
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
