'use client';

import Link from 'next/link';
import { Tag } from '@phosphor-icons/react';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Promotion } from '@/lib/types';

// Marketing banners on the Home page (public promo feed). A discovery surface:
// renders nothing while loading, on error, or when empty — never blocks the page.

function Banner({ promo }: { promo: Promotion }) {
  const inner = (
    <div
      className="relative flex min-h-32 w-72 shrink-0 flex-col justify-between overflow-hidden rounded-xl bg-brand-600 bg-cover bg-center p-4 text-white sm:w-80"
      // ponytail: decorative background via CSS (arbitrary promo-supplied URL); no image pipeline yet.
      style={promo.imageUrl ? { backgroundImage: `linear-gradient(rgba(31,122,224,0.75),rgba(31,122,224,0.75)), url(${JSON.stringify(promo.imageUrl)})` } : undefined}
    >
      <div className="relative flex flex-col gap-1">
        <h3 className="text-base font-bold">{promo.title}</h3>
        {promo.subtitle && <p className="text-sm text-white/90">{promo.subtitle}</p>}
      </div>
      <div className="relative flex items-center gap-2">
        {promo.voucherCode && (
          <span className="rounded-md bg-white/20 px-2 py-0.5 text-xs font-bold tracking-wide">
            {promo.voucherCode}
          </span>
        )}
        {promo.ctaLabel && (
          <span className="text-sm font-semibold underline underline-offset-2">{promo.ctaLabel}</span>
        )}
      </div>
    </div>
  );

  return promo.ctaHref ? (
    <Link href={promo.ctaHref} className="transition-transform hover:-translate-y-0.5">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function PromoCarousel() {
  const { data, loading, error } = useAsync<Promotion[]>(
    () => api.get<Promotion[]>(endpoints.promotions.list),
    [],
  );

  if (loading || error || !data || data.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Promo">
      <h2 className="flex items-center gap-1.5 text-lg font-bold">
        <Tag size={20} weight="fill" className="text-brand-600" /> Promo untukmu
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {data.map((promo) => (
          <Banner key={promo.id} promo={promo} />
        ))}
      </div>
    </section>
  );
}
