'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, Package, Receipt, User } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { useT } from '@/lib/locale-context';

// Mobile-only bottom tab bar (hidden on sm+, where the top nav carries the links).
export function BottomNav() {
  const pathname = usePathname();
  const { t } = useT();

  const tabs: { href: string; label: string; icon: Icon }[] = [
    { href: '/', label: t('nav.home'), icon: House },
    { href: '/products', label: t('nav.shop'), icon: Package },
    { href: '/orders', label: t('nav.orders'), icon: Receipt },
    { href: '/account', label: t('nav.account'), icon: User },
  ];

  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav
      className="surface fixed inset-x-0 bottom-0 z-30 flex border-t border-app pb-[env(safe-area-inset-bottom)] sm:hidden"
      aria-label="Navigasi utama"
    >
      {tabs.map(({ href, label, icon: Icon }) => {
        const on = active(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? 'page' : undefined}
            className={
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition-colors ' +
              (on ? 'text-brand-600' : 'text-muted')
            }
          >
            <Icon size={23} weight={on ? 'fill' : 'regular'} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
