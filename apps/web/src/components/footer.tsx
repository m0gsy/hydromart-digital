'use client';

import Link from 'next/link';
import { Drop } from '@phosphor-icons/react';

// Site footer, rendered once in the root layout below <main>. Deep-teal band
// (1c Fresh Flow) spanning full width with a centered inner container. Items
// with an href render as real links; the rest are plain text (no dead ends).
// Static content — no data fetching. ('use client' kept for the icon import.)

type FooterLink = { label: string; href?: string };

const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: 'Belanja',
    links: [
      { label: 'Semua produk', href: '/products' },
      { label: 'Galon & isi ulang', href: '/products' },
      { label: 'Air botol', href: '/products' },
    ],
  },
  {
    heading: 'Akun',
    links: [
      { label: 'Pesanan saya', href: '/orders' },
      { label: 'Rewards & poin', href: '/rewards' },
      { label: 'Alamat', href: '/addresses' },
      { label: 'Akun saya', href: '/account' },
    ],
  },
  {
    heading: 'Bantuan',
    links: [
      { label: 'Cara pesan' },
      { label: 'Jadi mitra depot' },
      { label: 'hello@hydromart-digital.com', href: 'mailto:hello@hydromart-digital.com' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-10 bg-brand-800 text-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-11 sm:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
                <Drop size={18} weight="fill" className="text-brand-800" />
              </span>
              <span className="text-base font-extrabold">hydromart</span>
            </div>
            <p className="max-w-[280px] text-sm leading-relaxed text-white/65">
              Galon isi ulang & air minum kemasan, diantar dari depot resmi terdekat ke rumahmu.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading} className="flex flex-col gap-2.5 text-sm">
              <h2 className="font-extrabold">{col.heading}</h2>
              {col.links.map((link) =>
                link.href ? (
                  <Link key={link.label} href={link.href} className="text-white/65 hover:text-white">
                    {link.label}
                  </Link>
                ) : (
                  <span key={link.label} className="text-white/65">
                    {link.label}
                  </span>
                ),
              )}
            </nav>
          ))}
        </div>

        <div className="mt-8 border-t border-white/15 pt-5 text-[13px] text-white/55">
          © 2026 Hydromart · Melayani pengiriman air minum di Indonesia
        </div>
      </div>
    </footer>
  );
}
