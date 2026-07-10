'use client';

import Link from 'next/link';
import { Drop } from '@phosphor-icons/react';

import { Money } from '@/components/ui';
import type { Product } from '@/lib/types';

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="surface group flex flex-col overflow-hidden rounded-xl border border-app transition-shadow hover:shadow-md"
    >
      <div className="flex aspect-square items-center justify-center bg-[color:var(--surface-muted)]">
        {product.imageUrl ? (
          // ponytail: plain img (arbitrary depot-supplied URLs). Swap to next/image
          // with a remote allowlist once image hosts are known.
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <Drop size={56} weight="thin" className="text-brand-300" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold">{product.name}</h3>
        <p className="text-xs text-muted">{product.unit}</p>
        <div className="mt-auto pt-2 font-bold text-brand-700">
          <Money amount={product.basePrice} />
        </div>
      </div>
    </Link>
  );
}
