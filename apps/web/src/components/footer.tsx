'use client';

import Link from 'next/link';
import { Drop } from '@phosphor-icons/react';

// Site footer, rendered once in the root layout below <main>. Links point at
// real routes; informational columns use the app's own pages so there are no
// dead ends. Static content — no data fetching.

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Belanja',
    links: [
      { label: 'Semua produk', href: '/products' },
      { label: 'Galon & isi ulang', href: '/products' },
      { label: 'Air botol', href: '/products' },
      { label: 'Keranjang', href: '/cart' },
    ],
  },
  {
    heading: 'Akun',
    links: [
      { label: 'Pesanan saya', href: '/orders' },
      { label: 'Alamat', href: '/addresses' },
      { label: 'Rewards & poin', href: '/rewards' },
      { label: 'Masuk / Daftar', href: '/login' },
    ],
  },
  {
    heading: 'Hydromart',
    links: [
      { label: 'Beranda', href: '/' },
      { label: 'Cara pesan', href: '/' },
      { label: 'Jadi mitra depot', href: '/' },
    ],
  },
];

export function Footer() {
  const year = 2026; // ponytail: static build year; app has no server clock in the client bundle.

  return (
    <footer className="mt-10 border-t border-app">
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 font-bold">
              <Drop size={24} weight="fill" className="text-brand-600" />
              <span>Hydromart</span>
            </div>
            <p className="text-sm text-muted">
              Galon isi ulang & air minum kemasan, diantar dari depot terdekat ke rumah Anda.
            </p>
            <a href="mailto:hello@hydromart-digital.com" className="text-sm font-semibold text-brand-700">
              hello@hydromart-digital.com
            </a>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading} className="flex flex-col gap-3">
              <h2 className="text-sm font-bold">{col.heading}</h2>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-sm text-muted hover:text-brand-700">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-app pt-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Hydromart. Semua hak dilindungi.</p>
          <p>Melayani pengiriman air minum di Indonesia.</p>
        </div>
      </div>
    </footer>
  );
}
