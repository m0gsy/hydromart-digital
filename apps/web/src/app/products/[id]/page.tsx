'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import {
  CaretRight,
  Check,
  Clock,
  Drop,
  Plus,
  ShoppingCartSimple,
  Storefront,
  Trophy,
} from '@phosphor-icons/react';

import { FavoriteButton } from '@/components/favorite-button';
import { QuantityStepper } from '@/components/quantity-stepper';
import { Button, Chip, ErrorState, MemberPrice, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useCart } from '@/lib/cart-context';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useLocation } from '@/lib/location-context';
import { useT } from '@/lib/locale-context';
import { memberPrice, useMemberRate } from '@/lib/member';
import { useAsync } from '@/lib/use-async';
import type { Category, LoyaltyAccount, NearbyDepot, Product, Recommendation } from '@/lib/types';

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { customer } = useAuth();
  const { bump, refresh } = useCart();
  const rate = useMemberRate();
  const { location } = useLocation();
  const { t } = useT();

  const { data: product, error, loading, reload } = useAsync<Product>(
    () => api.get(endpoints.products.get(id)),
    [id],
  );

  // Category name for the breadcrumb + tint pill — same source the catalog uses.
  const { data: categories } = useAsync<Category[]>(
    () => api.get<Category[]>(endpoints.products.categories),
    [],
  );
  const category = categories?.find((c) => c.id === product?.categoryId) ?? null;

  // Signed-in member's own tier — drives the amber note (hidden for guests). The
  // teaser member-price chip below still uses `rate` (entry-tier teaser).
  // ponytail: useMemberRate already fetches loyalty/me internally but doesn't
  // expose the tier; a second read is the lazy way to name the tier without
  // touching member.ts.
  const { data: account } = useAsync<LoyaltyAccount | null>(
    () => (customer ? api.get(endpoints.loyalty.me, true) : Promise.resolve(null)),
    [customer],
  );

  // Best-effort delivery discovery: nearest depot to the user's chosen location.
  // Never blocks the page — resolves to null when no location is set or none found.
  const { data: depot } = useAsync<NearbyDepot | null>(
    () =>
      location
        ? api
            .get<NearbyDepot[]>(
              endpoints.depots.nearby({ lat: location.lat, lng: location.lng, limit: 1 }),
            )
            .then((d) => d[0] ?? null)
        : Promise.resolve(null),
    [location?.lat, location?.lng],
  );

  // Frequently-bought-together — fed by the related-products source. No price on
  // Recommendation, so the mini-cards show name + unit only (never fabricated).
  const { data: related } = useAsync<Recommendation[]>(
    () => api.get<Recommendation[]>(endpoints.recommendations.related(id)),
    [id],
  );

  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function addToCart() {
    if (!customer) {
      router.push(`/login?next=${encodeURIComponent(`/products/${id}`)}`);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await api.post(endpoints.cart.items, { productId: id, quantity: qty }, true);
      setAdded(true);
      bump(qty);
      await refresh();
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : t('shop.pdp.addError'));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* breadcrumb — Belanja › {category} › {product} */}
      <nav
        aria-label="breadcrumb"
        className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-muted"
      >
        <Link href="/products" className="hover:text-brand-700">
          {t('nav.shop')}
        </Link>
        {category && (
          <>
            <CaretRight size={12} weight="bold" className="text-brand-300" />
            <Link href={`/products?category=${category.id}`} className="hover:text-brand-700">
              {category.name}
            </Link>
          </>
        )}
        {product && (
          <>
            <CaretRight size={12} weight="bold" className="text-brand-300" />
            <span className="text-[color:var(--text)]">{product.name}</span>
          </>
        )}
      </nav>

      {loading ? (
        <div className="grid gap-8 sm:grid-cols-2 sm:gap-12">
          <Skeleton className="aspect-square rounded-[24px]" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        </div>
      ) : error || !product ? (
        <ErrorState message={error ?? t('shop.pdp.notFound')} onRetry={reload} />
      ) : (
        <div className="grid items-start gap-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-12">
          {/* gallery */}
          <div className="flex flex-col gap-3">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[24px] bg-[color:var(--surface-soft)]">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <Drop size={96} weight="thin" className="text-brand-300" />
              )}
            </div>
            {/* The product payload carries a single imageUrl (the product model has no
                images[] array), so the thumbnail strip shows just the one real photo —
                a multi-image gallery would need fabricated extras.
                // ponytail: render a real strip here once the product model grows images[]. */}
            <div className="grid grid-cols-4 gap-3">
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[14px] border-2 border-brand-600 bg-[color:var(--surface-soft)]">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Drop size={26} weight="thin" className="text-brand-300" />
                )}
              </div>
            </div>
          </div>

          {/* info */}
          <div className="flex flex-col gap-[18px]">
            <div className="flex flex-col gap-2.5">
              {category && (
                <span className="w-fit rounded-full bg-brand-50 px-[13px] py-[5px] text-xs font-extrabold text-brand-800">
                  {category.name}
                </span>
              )}
              <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em]">
                {product.name}
              </h1>
              <p className="text-sm text-muted">
                {t('shop.pdp.unitSku', { unit: product.unit, sku: product.sku })}
              </p>
            </div>

            <div className="flex items-baseline gap-3">
              <Money
                amount={product.basePrice}
                className="text-[30px] font-extrabold tracking-tight"
              />
              {rate > 0 && <MemberPrice amount={memberPrice(product.basePrice, rate)} />}
            </div>

            {/* member note — signed-in members only, names the tier */}
            {customer && account && account.discountRate > 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-[color:var(--warning-bg)] px-3.5 py-2.5 text-[13px] text-[color:var(--warning)]">
                <Trophy size={16} weight="fill" />
                <span>
                  <span className="font-extrabold">{account.tier}</span>{' · '}
                  {t('shop.pdp.memberDiscount', { percent: Math.round(account.discountRate * 100) })}
                </span>
              </div>
            )}

            {/* delivery answer */}
            <div className="surface flex flex-col gap-3 rounded-[18px] border border-app p-[18px]">
              {depot ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50">
                      <Storefront size={18} weight="fill" className="text-brand-600" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{t('shop.pdp.deliveredFrom', { depot: depot.name })}</p>
                      <p className="text-[12.5px] text-muted">
                        {t('shop.pdp.deliveryMeta', { km: depot.distanceKm.toFixed(1).replace('.', ',') })}{' '}
                        <Money amount={depot.deliveryFee} />
                      </p>
                    </div>
                    <Chip tone="success">{t('shop.pdp.open')}</Chip>
                  </div>
                  <div className="flex items-center gap-2 border-t border-app pt-3 text-[13px] font-bold text-[color:var(--text)]">
                    <Clock size={16} weight="fill" className="text-brand-600" />
                    {t('shop.pdp.cutoff')}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50">
                    <Storefront size={18} weight="fill" className="text-brand-600" />
                  </span>
                  <p className="text-sm font-semibold text-muted">
                    {t('shop.pdp.setLocation')}
                  </p>
                </div>
              )}
            </div>

            {/* qty + CTA — sticky on mobile, inline on desktop */}
            <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3.5 border-t border-app bg-[color:var(--surface)] px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
              <QuantityStepper value={qty} onChange={setQty} disabled={adding} />
              <Button
                onClick={addToCart}
                loading={adding}
                className="h-[54px] flex-1 rounded-full text-[15.5px] font-extrabold"
              >
                {added ? (
                  <>
                    <Check size={19} weight="bold" /> {t('shop.pdp.added')}
                  </>
                ) : (
                  <>
                    <ShoppingCartSimple size={19} weight="fill" /> {t('shop.pdp.addToCart')}{' '}
                    <Money amount={qty * product.basePrice} />
                  </>
                )}
              </Button>
              <FavoriteButton productId={id} className="h-[54px] w-[54px]" />
            </div>

            {added && (
              <Link href="/cart" className="text-sm font-semibold text-brand-700">
                {t('shop.pdp.toCart')}
              </Link>
            )}
            {addError && (
              <p className="text-sm font-medium text-red-600" role="alert">
                {addError}
              </p>
            )}

            {product.description && (
              <p className="text-sm leading-[1.7] text-muted">{product.description}</p>
            )}
          </div>
        </div>
      )}

      {/* Frequently bought together — omitted entirely when there's no related data */}
      {product && related && related.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-4 text-[21px] font-extrabold tracking-tight">{t('shop.pdp.related')}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {related.slice(0, 4).map((item) => (
              <FbtCard key={item.productId} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// Horizontal mini-card for the frequently-bought row. Duplicates the add-to-cart
// wiring of ProductRecRail's RailCard — ponytail: the shared rail renders a
// different (scrolling) layout, so this page needs its own card shape.
function FbtCard({ item }: { item: Recommendation }) {
  const router = useRouter();
  const { t } = useT();
  const { customer } = useAuth();
  const { bump, refresh } = useCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function add(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!customer) {
      router.push(`/login?next=${encodeURIComponent(`/products/${item.productId}`)}`);
      return;
    }
    setAdding(true);
    bump(1); // optimistic badge; refresh reconciles
    try {
      await api.post(endpoints.cart.items, { productId: item.productId, quantity: 1 }, true);
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
      href={`/products/${item.productId}`}
      className="surface flex items-center gap-[13px] rounded-[18px] p-3 shadow-card transition-shadow hover:shadow-lift"
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[color:var(--surface-soft)]">
        <Drop size={30} weight="thin" className="text-brand-300" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-[13.5px] font-bold leading-snug">{item.name}</h3>
        <p className="mt-0.5 text-[13px] text-muted">{item.unit}</p>
      </div>
      <button
        onClick={add}
        disabled={adding}
        aria-label={t('shop.card.addAria', { name: item.name })}
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 transition-colors hover:bg-brand-600 hover:text-on-brand disabled:opacity-50"
      >
        {added ? <Check size={16} weight="bold" /> : <Plus size={16} weight="bold" />}
      </button>
    </Link>
  );
}
