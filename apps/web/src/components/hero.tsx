'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsClockwise, Drop, MagnifyingGlass } from '@phosphor-icons/react';

import { LocationSelector } from '@/components/location-selector';
import { useT } from '@/lib/locale-context';

// Home hero (1c Fresh Flow): teal-tint rounded panel with a big greeting, a
// rounded-full search pill, quick-search chips, the delivery-location control,
// and a designed image slot with a floating "beli lagi" affordance.

const QUICK = [
  { label: 'home.hero.quick.refill', q: 'galon' },
  { label: 'home.hero.quick.bottled', q: 'botol' },
  { label: 'home.hero.quick.dispenser', q: 'dispenser' },
];

export function Hero({ greetingName }: { greetingName?: string | null }) {
  const router = useRouter();
  const { t } = useT();
  const [term, setTerm] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    router.push(q ? `/products?search=${encodeURIComponent(q)}` : '/products');
  }

  const first = greetingName ? greetingName.split(' ')[0] : null;

  return (
    <section aria-label={t('home.hero.aria')} className="relative overflow-hidden rounded-3xl bg-brand-50 p-7 sm:p-10">
      <div className="grid items-center gap-8 lg:grid-cols-[1fr_minmax(0,420px)]">
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold leading-[1.08] tracking-tight text-[color:var(--text)] sm:text-[42px]">
            {first ? t('home.hero.greeting', { name: first }) : t('home.hero.titleGuest1')}
            <br />
            <span className="text-brand-800">{first ? t('home.hero.titleUser2') : t('home.hero.titleGuest2')}</span>
          </h1>
          <p className="max-w-md text-[15px] leading-relaxed text-muted sm:text-base">
            {t('home.hero.subtitle')}
          </p>

          <form onSubmit={submit} className="relative max-w-xl">
            <MagnifyingGlass
              size={19}
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-brand-600"
            />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('home.hero.searchPlaceholder')}
              aria-label={t('home.hero.searchAria')}
              className="h-[58px] w-full rounded-full bg-[color:var(--surface)] pl-12 pr-[120px] text-[15px] text-[color:var(--text)] shadow-card outline-none placeholder:text-muted focus:ring-2 focus:ring-brand-300"
            />
            <button
              type="submit"
              className="absolute right-[7px] top-1/2 flex h-11 -translate-y-1/2 items-center rounded-full bg-brand-600 px-6 text-sm font-bold text-on-brand transition-colors hover:bg-brand-700"
            >
              {t('home.hero.searchButton')}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <LocationSelector />
            {QUICK.map((c) => (
              <Link
                key={c.q}
                href={`/products?search=${c.q}`}
                className="text-deep-teal rounded-full bg-white/75 px-4 py-2 text-[13px] font-bold transition-colors hover:bg-white"
              >
                {t(c.label)}
              </Link>
            ))}
          </div>
        </div>

        <div className="relative hidden min-h-[300px] self-stretch lg:block">
          <div className="absolute inset-0 flex items-center justify-center rounded-[18px] bg-[color:var(--surface-soft)]">
            <Drop size={96} weight="thin" className="text-brand-300" />
          </div>
          <div className="pointer-events-none absolute -left-6 bottom-4 flex items-center gap-3 rounded-2xl bg-[color:var(--surface)] p-3.5 shadow-lift">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
              <ArrowsClockwise size={19} weight="fill" className="text-brand-600" />
            </span>
            <div>
              <div className="text-[13.5px] font-extrabold text-[color:var(--text)]">{t('home.hero.reorderTitle')}</div>
              <div className="text-[12.5px] text-muted">{t('home.hero.reorderSub')}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
