'use client';

import Link from 'next/link';
import { Drop } from '@phosphor-icons/react';

import { useT } from '@/lib/locale-context';

// Site footer, rendered once in the root layout below <main>. Deep-teal band
// (1c Fresh Flow) spanning full width with a centered inner container. Items
// with an href render as real links; the rest are plain text (no dead ends).
// Static content — no data fetching. ('use client' kept for the icon import.)

type FooterLink = { label: string; href?: string };

export function Footer() {
  const { t } = useT();

  const COLUMNS: { heading: string; links: FooterLink[] }[] = [
    {
      heading: t('auth.footer.shop'),
      links: [
        { label: t('auth.footer.allProducts'), href: '/products' },
        { label: t('auth.footer.gallonRefill'), href: '/products' },
        { label: t('auth.footer.bottled'), href: '/products' },
      ],
    },
    {
      heading: t('auth.footer.account'),
      links: [
        { label: t('auth.footer.myOrders'), href: '/orders' },
        { label: t('auth.footer.rewards'), href: '/rewards' },
        { label: t('auth.footer.address'), href: '/addresses' },
      ],
    },
    {
      heading: t('auth.footer.help'),
      links: [
        { label: t('auth.footer.howToOrder'), href: '/help' },
        { label: t('auth.footer.becomePartner') },
        { label: 'hello@hydromart-digital.com', href: 'mailto:hello@hydromart-digital.com' },
      ],
    },
  ];

  return (
    <footer className="bg-deep-teal mt-10 text-white">
      <div className="mx-auto w-full max-w-[1216px] px-5 pb-[30px] pt-11 sm:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white">
                <Drop size={18} weight="fill" className="text-deep-teal" />
              </span>
              <span className="text-base font-extrabold">hydromart</span>
            </div>
            <p className="max-w-[280px] text-[13.5px] leading-[1.55] text-white/65">
              {t('auth.footer.tagline')}
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading} className="flex flex-col gap-2.5 text-[13.5px]">
              <h2 className="text-[13.5px] font-extrabold">{col.heading}</h2>
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
          {t('auth.footer.copyright')}
        </div>
      </div>
    </footer>
  );
}
