'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MagnifyingGlass, Drop, CaretLeft, CaretRight } from '@phosphor-icons/react';

import { ProductCard } from '@/components/product-card';
import { ProductRecRail } from '@/components/product-rec-rail';
import { Button, CenterState, ErrorState, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useT } from '@/lib/locale-context';
import { useLocation } from '@/lib/location-context';
import { useMemberRate } from '@/lib/member';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Category, NearbyDepot, Page, Product } from '@/lib/types';

const LIMIT = 12;

function ProductsCatalog() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useT();
  const { location } = useLocation();

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

  // Best-effort nearest depot for the subtitle "diantar dari {depot} — {dist} km".
  // Mirrors the PDP pattern; resolves to null (→ generic subtitle) with no location.
  const { data: depot } = useAsync<NearbyDepot | null>(
    () =>
      location
        ? api
            .get<NearbyDepot[]>(endpoints.depots.nearby({ lat: location.lat, lng: location.lng, limit: 1 }))
            .then((d) => d[0] ?? null)
        : Promise.resolve(null),
    [location?.lat, location?.lng],
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

  const subtitle = depot
    ? t('shop.catalog.subtitleDepot', {
        depot: depot.name,
        dist: depot.distanceKm.toFixed(1).replace('.', ','),
      })
    : t('shop.catalog.subtitle');

  return (
    <div className="flex flex-col">
      {/* Header + search pill — one row (flex-end, space-between, 24px gap) on
          desktop, stacked on mobile. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[30px] font-extrabold leading-none tracking-[-0.03em] text-[color:var(--text)]">
            {t('shop.catalog.title')}
          </h1>
          <p className="text-[14.5px] text-muted">{subtitle}</p>
        </div>
        <form onSubmit={submitSearch} className="relative w-full sm:w-[380px]">
          <MagnifyingGlass
            size={18}
            className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2 text-brand-600"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('shop.catalog.searchPlaceholder')}
            aria-label={t('shop.catalog.searchLabel')}
            className="surface h-12 !rounded-full border-app pl-[44px] pr-[18px]"
          />
        </form>
      </div>

      {/* Category pills — quick filter + a way out of a zero-result state.
          Reserve the row height while categories load so the grid below doesn't
          shift down when the pills appear (min-h ≈ one pill row). */}
      {categories.loading && !categories.data ? (
        <div className="mt-5 min-h-[38px]" />
      ) : (categories.data?.length ?? 0) > 0 ? (
        <div className="mt-5 flex flex-wrap gap-[9px]">
          <Link
            href="/products"
            className={`rounded-full px-[18px] py-[9px] text-[13.5px] font-bold transition-colors ${
              categoryId
                ? 'surface border border-app text-muted hover:border-brand-600'
                : 'bg-[color:var(--text)] text-[color:var(--surface)]'
            }`}
          >
            {t('shop.catalog.all')}
          </Link>
          {categories.data!.map((c) => (
            <Link
              key={c.id}
              href={`/products?category=${c.id}`}
              className={`rounded-full px-[18px] py-[9px] text-[13.5px] font-bold transition-colors ${
                c.id === categoryId
                  ? 'bg-[color:var(--text)] text-[color:var(--surface)]'
                  : 'surface border border-app text-muted hover:border-brand-600'
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}

      {/* sr-only h2 keeps heading order valid (page h1 → list h2 → card h3). */}
      <h2 className="sr-only">{t('shop.catalog.title')}</h2>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            // Card-shaped skeleton (square image + content block) so its height
            // matches the real ProductCard and the swap doesn't shift layout.
            <div key={i} className="surface flex flex-col overflow-hidden rounded-2xl shadow-card">
              <Skeleton className="aspect-square !rounded-none" />
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/3 rounded" />
                <Skeleton className="mt-3 h-5 w-1/2 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="pt-6">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : empty ? (
        <div className="pt-6">
          <EmptyState query={query} category={activeCategory?.name ?? (categoryId ? '' : null)} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 pb-2 pt-6 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((product) => (
              <ProductCard key={product.id} product={product} memberRate={memberRate} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pb-10 pt-[22px]">
              <PageButton
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label={t('shop.catalog.prevPage')}
              >
                <CaretLeft size={15} weight="bold" />
              </PageButton>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <PageButton key={n} onClick={() => setPage(n)} active={n === page} aria-label={t('shop.catalog.pageN', { n })}>
                  {n}
                </PageButton>
              ))}
              <PageButton
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label={t('shop.catalog.nextPage')}
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
  const { t } = useT();
  if (query) {
    return (
      <div className="flex flex-col gap-4">
        <CenterState
          icon={<Drop size={48} weight="thin" />}
          title={t('shop.empty.searchTitle', { query })}
          action={<LinkButtonHome label={t('shop.empty.clearSearch')} />}
        >
          {t('shop.empty.searchBody')}
        </CenterState>
        {/* Fallback discovery surface so the search dead-end still offers a path forward. */}
        <ProductRecRail title={t('shop.catalog.trending')} endpoint={endpoints.recommendations.trending()} />
      </div>
    );
  }
  if (category !== null) {
    return (
      <CenterState
        icon={<Drop size={48} weight="thin" />}
        title={category ? t('shop.empty.categoryTitle', { category }) : t('shop.empty.categoryTitleUnknown')}
        action={<LinkButtonHome label={t('shop.empty.viewAll')} href="/products" />}
      >
        {t('shop.empty.categoryBody')}
      </CenterState>
    );
  }
  return (
    <CenterState
      icon={<Drop size={48} weight="thin" />}
      title={t('shop.empty.catalogTitle')}
      action={<LinkButtonHome label={t('shop.empty.backHome')} href="/" />}
    >
      {t('shop.empty.catalogBody')}
    </CenterState>
  );
}

function LinkButtonHome({ label, href = '/products' }: { label: string; href?: string }) {
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
