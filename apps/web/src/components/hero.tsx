'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlass } from '@phosphor-icons/react';

import { LinkButton } from '@/components/ui';
import { LocationSelector } from '@/components/location-selector';

// Full-bleed Home hero: value proposition + delivery-location answer + search.
// Breaks out of the layout's max-w-5xl/px-4 shell with -mx-4 and re-pads inside.

export function Hero({ greetingName }: { greetingName?: string | null }) {
  const router = useRouter();
  const [term, setTerm] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    router.push(q ? `/products?search=${encodeURIComponent(q)}` : '/products');
  }

  return (
    <section className="-mx-4 bg-gradient-to-b from-brand-600 to-brand-500 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-10 sm:py-14">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold sm:text-4xl">
            {greetingName ? `Halo, ${greetingName.split(' ')[0]}` : 'Air minum, diantar ke rumah'}
          </h1>
          <p className="max-w-xl text-white/90">
            Galon isi ulang dan air botol dari depot terdekat. Pesan sekarang, kami antar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-lg bg-white/10 p-0.5">
            <LocationSelector />
          </div>
        </div>

        <form onSubmit={submit} className="relative max-w-xl">
          <MagnifyingGlass
            size={20}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-600"
          />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Cari galon, botol, dispenser…"
            aria-label="Cari produk"
            className="w-full rounded-lg border border-transparent bg-white py-3 pl-10 pr-28 text-[color:var(--text)] outline-none focus:border-brand-300"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Cari
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          <LinkButton href="/products" variant="secondary">
            Pesan sekarang
          </LinkButton>
        </div>
      </div>
    </section>
  );
}
