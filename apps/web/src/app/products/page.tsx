'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { MagnifyingGlass, Drop } from '@phosphor-icons/react';

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

  /**
   * The grid accumulates pages instead of replacing them — "load more" keeps what you have
   * already scrolled past, which is also what stops a back navigation from losing your
   * place. Three things this shape buys, all of which the obvious version gets wrong:
   *
   * - Keyed by page number, not appended, so re-running the loader (StrictMode does, twice)
   *   cannot write the same page into the grid twice.
   * - Stamped with the filter signature, so changing search or category reads as "nothing
   *   loaded yet" on the very same render. Clearing it in an effect instead would paint one
   *   frame of the empty state between the tap and the skeletons.
   * - `total` is remembered here rather than read off the last response, because a failed
   *   "load more" leaves `useAsync` holding the response before it.
   */
  const sig = `${query}|${categoryId}`;
  const [loaded, setLoaded] = useState<{ sig: string; byPage: Record<number, Product[]>; total: number }>({
    sig,
    byPage: {},
    total: 0,
  });
  // Read inside the loader's `then`, where `sig` itself would be the value captured when
  // the request went out — that is exactly the response we have to ignore.
  const sigRef = useRef(sig);
  sigRef.current = sig;

  // One loyalty fetch for the whole grid; passed to every card.
  const memberRate = useMemberRate();

  // Reset paging + sync the input when the URL filters change.
  useEffect(() => {
    setPage(1);
    setSearch(query);
  }, [query, categoryId]);

  const categories = useAsync<Category[]>(() => api.getCached<Category[]>(endpoints.products.categories), []);
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

  // The filters changing beats `setPage(1)` to the render, so ask for page 1 whenever what
  // is on screen belongs to a different filter — otherwise a category tapped from page 3
  // fetches page 3 of the new category first.
  const activePage = loaded.sig === sig ? page : 1;

  const { error, loading, reload } = useAsync<Page<Product>>(() => {
    const forSig = sig;
    const forPage = activePage;
    return api
      .get<Page<Product>>(
        endpoints.products.browse({
          page: forPage,
          limit: LIMIT,
          search: query || undefined,
          categoryId: categoryId || undefined,
        }),
      )
      .then((res) => {
        if (sigRef.current !== forSig) return res; // a filter we have already left
        setLoaded((prev) => ({
          sig: forSig,
          byPage: prev.sig === forSig ? { ...prev.byPage, [forPage]: res.items } : { [forPage]: res.items },
          total: res.total,
        }));
        return res;
      });
  }, [activePage, query, categoryId]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    const p = new URLSearchParams();
    if (q) p.set('search', q);
    if (categoryId) p.set('category', categoryId);
    router.push(`/products${p.toString() ? `?${p.toString()}` : ''}`);
  }

  const fresh = loaded.sig === sig;
  const items = useMemo(
    () =>
      fresh
        ? Object.keys(loaded.byPage)
            .map(Number)
            .sort((a, b) => a - b)
            .flatMap((n) => loaded.byPage[n] ?? [])
        : [],
    [fresh, loaded.byPage],
  );

  // Skeletons until the first page of *these* filters has landed — `loading` alone is also
  // true while page 2 is in flight, and swapping the grid out for skeletons then would
  // throw away exactly what the reader was looking at.
  const firstLoad = !error && (!fresh || (loading && items.length === 0));
  const empty = items.length === 0;
  const hasMore = fresh && items.length < loaded.total;

  const subtitle = depot
    ? t('shop.catalog.subtitleDepot', {
        depot: depot.name,
        dist: depot.distanceKm.toFixed(1).replace('.', ','),
      })
    : t('shop.catalog.subtitle');

  return (
    <div className="flex flex-col">
      {/* Header + search pill — one row (flex-end, space-between, 24px gap) on
          desktop, stacked on mobile. Below `sm:` the app bar carries the title and the
          search field, so all that is left here is the depot line: the heading stays in
          the document for screen readers and heading order, and the pill would be the
          second one on screen. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="sr-only text-[30px] font-extrabold leading-none tracking-[-0.03em] text-[color:var(--text)] sm:not-sr-only">
            {t('shop.catalog.title')}
          </h1>
          <p className="text-[13.5px] text-muted sm:text-[14.5px]">{subtitle}</p>
        </div>
        <form onSubmit={submitSearch} className="relative hidden w-full sm:block sm:w-[380px]">
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
        // One scrolling row on a phone — wrapping pills push the grid a whole row down
        // per extra category. The negative margin + padding bleeds the row to the screen
        // edge so the last pill is visibly cut off, which is what says "scrollable".
        <div className="no-scrollbar -mx-4 mt-5 flex snap-x gap-[9px] overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <Link
            href="/products"
            className={`flex-none snap-start rounded-full px-[18px] py-[9px] text-[13.5px] font-bold transition-colors ${
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
              className={`min-h-11 flex-none snap-start whitespace-nowrap rounded-full px-[18px] py-[9px] text-[13.5px] font-bold transition-colors ${
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

      {firstLoad ? (
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
      ) : error && empty ? (
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
            {items.map((product) => (
              <ProductCard key={product.id} product={product} memberRate={memberRate} />
            ))}
          </div>
          {/* One button instead of numbered pages: numbers on a phone are 38px targets in a
              row, and paging away and back lost the scroll position every time. */}
          {hasMore && (
            <div className="flex justify-center pb-10 pt-[22px]">
              <Button
                variant="secondary"
                loading={loading}
                // After a failure the next page is still the one that failed — advancing
                // would skip it silently. Retry the same request instead.
                onClick={error ? reload : () => setPage((p) => p + 1)}
              >
                {t('shop.catalog.loadMore')}
              </Button>
            </div>
          )}
          {error && !loading && (
            <p className="pb-10 text-center text-[13.5px] text-muted">{error}</p>
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
