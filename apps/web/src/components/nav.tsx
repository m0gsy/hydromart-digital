'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Drop, ShoppingCartSimple, User } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useT } from '@/lib/locale-context';
import { canViewDashboard, isStaff } from '@/lib/roles';

export function Nav() {
  const { customer, ready } = useAuth();
  const { count } = useCart();
  const { t } = useT();
  const pathname = usePathname();

  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const pill = (href: string, label: string) => (
    <Link
      href={href}
      className={
        'rounded-full px-4 py-2 text-sm font-bold transition-colors ' +
        (active(href) ? 'bg-brand-50 text-brand-800' : 'text-muted hover:bg-brand-50')
      }
    >
      {label}
    </Link>
  );

  return (
    <header className="surface sticky top-0 z-30 border-b border-app">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-extrabold tracking-tight">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600">
            <Drop size={19} weight="fill" className="text-white" />
          </span>
          <span className="text-lg">hydromart</span>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* primary links — desktop only; mobile uses the bottom tab bar */}
          <div className="hidden items-center gap-1.5 sm:flex">
            {pill('/products', t('nav.shop'))}
            {ready && customer && pill('/orders', t('nav.orders'))}
            {ready && customer && canViewDashboard(customer.role) && pill('/dashboard', t('nav.ops'))}
            {ready && customer && !canViewDashboard(customer.role) && isStaff(customer.role) &&
              pill('/dashboard/orders', t('nav.ops'))}
          </div>

          {/* cart — ink button with teal badge (1c signature) */}
          <Link
            href="/cart"
            aria-label={t('nav.cart')}
            className="relative flex items-center justify-center rounded-full bg-[color:var(--text)] p-2.5 text-[color:var(--surface)] transition-transform active:scale-95"
          >
            <ShoppingCartSimple size={20} weight="fill" />
            {count > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-extrabold text-on-brand">
                {count}
              </span>
            )}
          </Link>

          {ready && customer ? (
            <Link
              href="/account"
              aria-label={t('nav.account')}
              className={
                'flex h-9 w-9 items-center justify-center rounded-full border border-app text-sm font-extrabold transition-colors ' +
                (active('/account') ? 'bg-brand-50 text-brand-800' : 'hover:bg-brand-50')
              }
            >
              {customer.fullName?.trim()?.[0]?.toUpperCase() ?? <User size={18} />}
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-full px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50"
            >
              {t('nav.signIn')}
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
