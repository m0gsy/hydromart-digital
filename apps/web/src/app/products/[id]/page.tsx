'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { ArrowLeft, Check, Drop } from '@phosphor-icons/react';

import { ProductRecRail } from '@/components/product-rec-rail';
import { QuantityStepper } from '@/components/quantity-stepper';
import { Button, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { Product } from '@/lib/types';

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { customer } = useAuth();

  const { data: product, error, loading, reload } = useAsync<Product>(
    () => api.get(endpoints.products.get(id)),
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
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : 'Could not add to cart.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/products" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
        <ArrowLeft size={16} /> Back to catalog
      </Link>

      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <Skeleton className="aspect-square" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      ) : error || !product ? (
        <ErrorState message={error ?? 'Product not found.'} onRetry={reload} />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="surface flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-app">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <Drop size={96} weight="thin" className="text-brand-300" />
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-2xl font-bold">{product.name}</h1>
              <p className="text-sm text-muted">{product.unit}</p>
            </div>
            <div className="text-3xl font-bold text-brand-700">
              <Money amount={product.basePrice} />
            </div>
            {product.description && (
              <p className="text-sm leading-relaxed text-muted">{product.description}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <QuantityStepper value={qty} onChange={setQty} disabled={adding} />
              <Button onClick={addToCart} loading={adding} className="flex-1 sm:flex-none">
                {added ? (
                  <>
                    <Check size={18} /> Added
                  </>
                ) : (
                  'Add to cart'
                )}
              </Button>
            </div>

            {added && (
              <Link href="/cart" className="text-sm font-semibold text-brand-700">
                Go to cart →
              </Link>
            )}
            {addError && (
              <p className="text-sm font-medium text-red-600" role="alert">
                {addError}
              </p>
            )}
          </div>
        </div>
      )}

      {product && (
        <ProductRecRail
          title="Frequently bought together"
          endpoint={endpoints.recommendations.related(id)}
        />
      )}
    </div>
  );
}
