'use client';

import Link from 'next/link';
import { ArrowRight, Broom, Drop, Package, Thermometer } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { SectionHeader } from '@/components/ui';
import { MotionSection, MotionItem, pressable } from '@/components/motion';
import type { Category } from '@/lib/types';

// Category pills on the Home page. Each deep-links into the catalog filtered by
// category (products page reads ?category=<id>). Hides when no categories.

// Per-name icon so the row isn't a wall of identical drops. Falls back to Drop.
function iconFor(name: string): Icon {
  const n = name.toLowerCase();
  if (n.includes('dispenser')) return Thermometer;
  if (n.includes('botol') || n.includes('kemasan')) return Package;
  if (n.includes('aksesori') || n.includes('tutup') || n.includes('pompa') || n.includes('bersih'))
    return Broom;
  return Drop; // galon / refill / isi ulang / default
}

export function CategoryGrid() {
  const { data, loading, error } = useAsync<Category[]>(
    () => api.get<Category[]>(endpoints.products.categories),
    [],
  );

  if (loading || error || !data || data.length === 0) return null;

  return (
    <section aria-label="Kategori">
      <SectionHeader title="Kategori" />
      <MotionSection className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.map((cat) => {
          const CatIcon = iconFor(cat.name);
          return (
            <MotionItem key={cat.id} {...pressable}>
              <Link
                href={`/products?category=${cat.id}`}
                className="surface flex items-center gap-3.5 rounded-full border border-app p-2.5 pr-5 transition-[border-color,box-shadow] hover:border-brand-600 hover:shadow-card"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50">
                  <CatIcon size={22} weight="fill" className="text-brand-600" />
                </span>
                <span className="font-bold text-[color:var(--text)]">{cat.name}</span>
                <ArrowRight size={16} className="ml-auto shrink-0 text-brand-600" />
              </Link>
            </MotionItem>
          );
        })}
      </MotionSection>
    </section>
  );
}
