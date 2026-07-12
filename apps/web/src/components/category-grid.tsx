'use client';

import Link from 'next/link';
import { ArrowRight, ArrowsClockwise, Drop, DropHalf, Package } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import { SectionHeader } from '@/components/ui';
import { MotionSection, MotionItem, pressable } from '@/components/motion';
import type { Category } from '@/lib/types';

// Category pills on the Home page. Each deep-links into the catalog filtered by
// category (products page reads ?category=<id>). Hides when no categories.

// Per-name icon so the row isn't a wall of identical drops. Falls back to Drop.
function iconFor(name: string): Icon {
  const n = name.toLowerCase();
  if (n.includes('gelas')) return DropHalf; // air gelas / cup
  if (n.includes('botol') || n.includes('kemasan')) return Drop; // air botol
  if (n.includes('aksesori') || n.includes('dispenser') || n.includes('tutup') || n.includes('pompa'))
    return Package;
  return ArrowsClockwise; // isi ulang / galon / refill / default
}

export function CategoryGrid() {
  const { t } = useT();
  const { data, loading, error } = useAsync<Category[]>(
    () => api.get<Category[]>(endpoints.products.categories),
    [],
  );

  if (loading || error || !data || data.length === 0) return null;

  return (
    <section aria-label={t('home.category.aria')}>
      <SectionHeader title={t('home.category.title')} />
      <MotionSection className="flex flex-wrap gap-[14px]">
        {data.map((cat) => {
          const CatIcon = iconFor(cat.name);
          return (
            <MotionItem key={cat.id} className="flex-1 basis-[240px]" {...pressable}>
              <Link
                href={`/products?category=${cat.id}`}
                className="surface flex items-center gap-3.5 rounded-full border border-app p-2.5 pr-5 transition-[border-color,box-shadow] hover:border-brand-600 hover:shadow-card"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50">
                  <CatIcon size={22} weight="fill" className="text-brand-600" />
                </span>
                <span className="text-[15px] font-bold text-[color:var(--text)]">{cat.name}</span>
                <ArrowRight size={16} className="ml-auto shrink-0 text-brand-600" />
              </Link>
            </MotionItem>
          );
        })}
      </MotionSection>
    </section>
  );
}
