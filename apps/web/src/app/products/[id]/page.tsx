'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import {
  ArrowLeft,
  CaretRight,
  Check,
  Clock,
  Drop,
  ShoppingCartSimple,
  Storefront,
  Trophy,
} from '@phosphor-icons/react';

import { ProductRecRail } from '@/components/product-rec-rail';
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
import type { NearbyDepot, Product } from '@/lib/types';

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
      {/* breadcrumb / back */}
      <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
        <Link href="/products" className="inline-flex items-center gap-1.5 hover:text-brand-700">
          <ArrowLeft size={15} /> {t('shop.pdp.backToCatalog')}
        </Link>
        {product && (
          <>
            <CaretRight size={11} className="text-brand-300" />
            <span className="text-[color:var(--text)]">{product.name}</span>
          </>
        )}
      </div>

      {loading ? (
        <div className="grid gap-8 sm:grid-cols-2 sm:gap-12">
          <Skeleton className="aspect-square rounded-2xl" />
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
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-[color:var(--surface-soft)]">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <Drop size={96} weight="thin" className="text-brand-300" />
            )}
          </div>

          {/* info */}
          <div className="flex flex-col gap-[18px]">
            <div className="flex flex-col gap-2">
              <h1 className="text-[32px] font-extrabold leading-tight tracking-tight">
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

            {rate > 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-[color:var(--warning-bg)] px-3.5 py-2.5 text-[13px] font-medium text-[color:var(--warning)]">
                <Trophy size={16} weight="fill" />
                {t('shop.pdp.memberDiscount', { percent: Math.round(rate * 100) })}
              </div>
            )}

            {/* delivery answer */}
            <div className="surface flex flex-col gap-3 rounded-2xl border border-app p-[18px]">
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
                  <div className="flex items-center gap-2 border-t border-app pt-3 text-[13px] font-bold text-[color:var(--text-muted)]">
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
                className="h-14 flex-1 rounded-full text-[15px]"
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
              <p className="text-sm leading-relaxed text-muted">{product.description}</p>
            )}
          </div>
        </div>
      )}

      {product && (
        <ProductRecRail
          title={t('shop.pdp.related')}
          endpoint={endpoints.recommendations.related(id)}
        />
      )}
    </div>
  );
}
