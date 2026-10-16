'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsClockwise, Drop, MagnifyingGlass } from '@phosphor-icons/react';

import { RemoteImage } from '@/components/remote-image';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Category, Page, Product } from '@/lib/types';

// Home hero (1c Fresh Flow): teal-tint rounded panel with a big greeting, a
// rounded-full search pill, quick-search chips, and a designed image slot with a
// floating "beli lagi" affordance. The delivery-location control now lives in the
// depot card, not here.

/**
 * Fallback chips, used only until the real categories land (and if the catalog has none).
 * These are free-text searches, which is what every chip used to be: tapping "Air botol"
 * ran a search for "botol" and left the catalog's category filter on "Semua", so the chip
 * looked like a filter and behaved like a guess at product names.
 */
const QUICK = [
  { label: 'home.hero.quick.refill', q: 'galon' },
  { label: 'home.hero.quick.bottled', q: 'botol' },
  { label: 'home.hero.quick.dispenser', q: 'dispenser' },
];

export function Hero({ greetingName }: { greetingName?: string | null }) {
  const router = useRouter();
  const { t } = useT();
  const [term, setTerm] = useState('');

  // The chips are shortcuts into the catalog's own filter, so they are the catalog's own
  // categories — same cached request the catalog makes, so it costs nothing extra — rather
  // than three hardcoded words hoping to match a product name.
  const categories = useAsync<Category[]>(
    () => api.getCached<Category[]>(endpoints.products.categories),
    [],
  );
  const chips =
    categories.data && categories.data.length > 0
      ? categories.data.slice(0, 3).map((c) => ({ label: c.name, href: `/products?category=${c.id}` }))
      : QUICK.map((c) => ({ label: t(c.label), href: `/products?search=${c.q}` }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    router.push(q ? `/products?search=${encodeURIComponent(q)}` : '/products');
  }

  /*
   * The right-hand slot used to be a tinted box with a droplet in it — a permanent
   * "image failed to load" for every visitor, because nothing ever filled it. It now shows a
   * real catalogue photo, and when the catalogue has none the whole column is dropped
   * rather than drawing a placeholder that reads as broken.
   */
  const featured = useAsync<Product | null>(async () => {
    const page = await api
      .getCached<Page<Product>>(endpoints.products.browse({ limit: 12 }))
      .catch(() => null);
    return page?.items.find((p) => p.imageUrl) ?? null;
  }, []);
  const photo = featured.data?.imageUrl ? featured.data : null;

  const first = greetingName ? greetingName.split(' ')[0] : null;

  return (
    <section
      aria-label={t('home.hero.aria')}
      className={`grid items-center gap-8 overflow-hidden rounded-[26px] bg-brand-50 p-8 sm:px-12 sm:py-11 lg:gap-12 ${
        photo ? 'lg:grid-cols-[1fr_460px]' : ''
      }`}
    >
      <div className="flex flex-col gap-[18px]">
        <h1 className="text-[34px] font-extrabold leading-[1.08] tracking-[-0.03em] text-[color:var(--text)] sm:text-[42px]">
          {first ? t('home.hero.greeting', { name: first }) : t('home.hero.titleGuest1')}
          <br />
          <span className="text-brand-800">{first ? t('home.hero.titleUser2') : t('home.hero.titleGuest2')}</span>
        </h1>
        <p className="max-w-[440px] text-base leading-[1.6] text-[#3d565e] dark:text-[color:var(--text-muted)]">
          {t('home.hero.subtitle')}
        </p>

        <form onSubmit={submit} className="relative max-w-[520px]">
          <MagnifyingGlass
            size={19}
            className="pointer-events-none absolute left-[22px] top-1/2 -translate-y-1/2 text-brand-600"
          />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('home.hero.searchPlaceholder')}
            aria-label={t('home.hero.searchAria')}
            style={{ boxShadow: '0 6px 20px rgba(11,77,87,0.10)' }}
            className="h-[58px] w-full rounded-full bg-[color:var(--surface)] pl-[52px] pr-[130px] text-[15px] text-[color:var(--text)] outline-none placeholder:text-muted focus:ring-2 focus:ring-brand-300"
          />
          <button
            type="submit"
            className="absolute right-[7px] top-[7px] flex h-11 items-center rounded-full bg-brand-600 px-6 text-sm font-bold text-on-brand transition-colors hover:bg-brand-700"
          >
            {t('home.hero.searchButton')}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2.5">
          {chips.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              // In the dark theme `bg-white/75` was a washed-out grey pill with dark-teal text
              // on it: neither the light chip nor the dark page, and hard to read. The dark
              // variant sits on the panel as a translucent tint with the normal text colour.
              className="text-deep-teal inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-white/75 px-5 py-2.5 text-sm font-bold leading-none transition-colors hover:bg-white dark:bg-white/10 dark:text-[color:var(--text)] dark:hover:bg-white/20"
            >
              {c.label}
            </Link>
          ))}
        </div>
      </div>

      {photo && (
        <div className="relative hidden min-h-[340px] self-stretch lg:block">
          {/* The catalogue photo is a product shot on an OPAQUE white background. Sitting on the
              theme's soft surface with padding around it, it read as a white box floating in a
              dark frame with empty corners, and the dark theme made that look like a cropped
              picture. The frame is the photo's own white and the picture fills it, so it is
              one full image in both themes; `object-contain` still shows the whole product. */}
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[18px] bg-white">
            <RemoteImage
              src={photo.imageUrl as string}
              alt={photo.name}
              className="h-full w-full object-contain"
              fallback={<Drop size={96} weight="thin" className="text-brand-300" />}
            />
          </div>
          {/* A real shortcut now, and only for somebody who has orders to repeat: it used to
              be a card that looked tappable and went nowhere. */}
          {first && (
            <Link
              href="/orders"
              style={{ boxShadow: '0 10px 28px rgba(11,77,87,0.14)' }}
              className="absolute -left-6 bottom-4 flex items-center gap-3 rounded-2xl bg-[color:var(--surface)] px-4 py-3 transition-transform hover:-translate-y-0.5"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                <ArrowsClockwise size={19} weight="fill" className="text-brand-600" />
              </span>
              <div>
                <div className="text-[13.5px] font-extrabold text-[color:var(--text)]">{t('home.hero.reorderTitle')}</div>
                <div className="text-[12.5px] text-muted">{t('home.hero.reorderSub')}</div>
              </div>
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
