'use client';

import Link from 'next/link';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
import type { Promotion } from '@/lib/types';

// Marketing banners on the Home page (public promo feed). A discovery surface:
// renders nothing while loading, on error, or when empty — never blocks the page.
// Cards alternate treatment by index: even = deep-teal, odd = amber.

function Banner({ promo, index }: { promo: Promotion; index: number }) {
  const teal = index % 2 === 0;
  const inner = (
    <div
      className={
        teal
          ? 'flex h-full flex-col justify-between gap-5 rounded-2xl bg-brand-800 p-7 text-white shadow-card'
          : 'flex h-full flex-col justify-between gap-5 rounded-2xl bg-amber-50 p-7 text-amber-900 shadow-card'
      }
    >
      <div>
        <h3 className="text-[22px] font-extrabold tracking-tight">{promo.title}</h3>
        {promo.subtitle && (
          <p className={teal ? 'mt-1.5 text-sm text-white/75' : 'mt-1.5 text-sm text-amber-800'}>
            {promo.subtitle}
          </p>
        )}
      </div>
      {(promo.voucherCode || promo.ctaLabel) && (
        <div className="flex items-center gap-3">
          {promo.voucherCode && (
            <span
              className={
                teal
                  ? 'rounded-[10px] border-[1.5px] border-dashed border-white/45 px-3.5 py-1.5 font-mono text-[13px] font-bold tracking-[0.08em]'
                  : 'rounded-[10px] border-[1.5px] border-dashed border-amber-900/40 px-3.5 py-1.5 font-mono text-[13px] font-bold tracking-[0.08em]'
              }
            >
              {promo.voucherCode}
            </span>
          )}
          {promo.ctaLabel && (
            <span
              className={
                teal
                  ? 'inline-flex rounded-full bg-white px-4 py-2 text-[13.5px] font-extrabold text-brand-800'
                  : 'inline-flex rounded-full bg-amber-600 px-4 py-2 text-[13.5px] font-extrabold text-white'
              }
            >
              {promo.ctaLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );

  return promo.ctaHref ? (
    <Link href={promo.ctaHref} className="block h-full transition-transform hover:-translate-y-0.5">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function PromoCarousel() {
  const { t } = useT();
  const { data, loading, error } = useAsync<Promotion[]>(
    () => api.get<Promotion[]>(endpoints.promotions.list),
    [],
  );

  if (loading || error || !data || data.length === 0) return null;

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label={t('home.promo.aria')}>
      {data.map((promo, i) => (
        <Banner key={promo.id} promo={promo} index={i} />
      ))}
    </section>
  );
}
