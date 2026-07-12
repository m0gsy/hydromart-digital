'use client';

import Link from 'next/link';
import { Drop } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Category } from '@/lib/types';

// Category tiles on the Home page. Each tile deep-links into the catalog filtered
// by category (products page reads ?category=<id>). Hides when no categories.

export function CategoryGrid() {
  const { data, loading, error } = useAsync<Category[]>(
    () => api.get<Category[]>(endpoints.products.categories),
    [],
  );

  if (loading || error || !data || data.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Kategori">
      <h2 className="text-lg font-bold">Kategori</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {data.map((cat) => (
          <Link
            key={cat.id}
            href={`/products?category=${cat.id}`}
            className="surface flex items-center gap-3 rounded-xl border border-app p-4 transition-shadow hover:shadow-md"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
              <Drop size={22} weight="fill" className="text-brand-600" />
            </span>
            <span className="font-semibold">{cat.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
