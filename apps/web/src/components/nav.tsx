'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ShoppingCartSimple, User } from '@phosphor-icons/react';

import { LocationSelector } from '@/components/location-selector';
import { BrandMark } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useT } from '@/lib/locale-context';
import { formatIDR } from '@/lib/format';
import { canViewDashboard, isStaff } from '@/lib/roles';

export function Nav() {
  const { customer, ready } = useAuth();
  const { count, cart } = useCart();
  const { t } = useT();
  const pathname = usePathname();

  // Staff accounts don't shop. The shop chrome (Belanja / Pesanan / cart) is hidden for
  // every non-CUSTOMER role — they keep only their console pill, notifications, account.
  const staff = ready && customer != null && isStaff(customer.role);

  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  // 1c pill link (Belanja / Pesanan / Operasi): muted when inactive, tint when on.
  const pill = (href: string, label: string) => (
    <Link
      href={href}
      className={
        'rounded-full px-4 py-[9px] text-sm font-bold transition-colors ' +
        (active(href) ? 'bg-brand-50 text-brand-800' : 'text-muted hover:bg-brand-50')
      }
    >
      {label}
    </Link>
  );

  // Below `sm:` this header is replaced by `AppBar` — see `AppShell`.
  return (
    <header className="surface sticky top-0 z-30 hidden border-b border-app sm:block">
      <nav className="mx-auto flex h-16 max-w-[1216px] items-center gap-3 px-4 sm:h-[72px] sm:gap-5 sm:px-8">
        {/* A15: the FIFTH hand-built copy of the lockup, found only after the other four
            were centralised. */}
        <Link href="/">
          <BrandMark />
        </Link>

        {/* A14. This was a `<Link href="/">` wearing a pin, a label and a caret: it looked
            exactly like a dropdown and went to the home page instead. Someone tapping it to
            change depot got navigated away, which reads as the app losing the tap.

            The note left here said the real selector "can't be driven from here without
            editing it" and to make it controllable first. It turned out not to need that —
            `LocationSelector` owns its own open state, so it only ever needed mounting. */}
        <div className="hidden sm:block">
          <LocationSelector compact />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* primary links — desktop only; mobile uses the bottom tab bar */}
          <div className="hidden items-center gap-1.5 sm:flex">
            {!staff && pill('/products', t('nav.shop'))}
            {ready && customer && !staff && pill('/orders', t('nav.orders'))}
            {ready && customer && canViewDashboard(customer.role) && pill('/dashboard', t('nav.ops'))}
            {ready && customer && customer.role === 'STAFF_DEPOT' && pill('/driver', 'Pengantaran')}
            {ready && customer && customer.role !== 'STAFF_DEPOT' && !canViewDashboard(customer.role) &&
              isStaff(customer.role) && pill('/dashboard/orders', t('nav.ops'))}
          </div>

          {/* cart — ink button carrying the running subtotal + teal count badge (1c signature) */}
          {!staff && (
          <Link
            href="/cart"
            aria-label={t('nav.cart')}
            className="relative flex items-center gap-2 rounded-full bg-[color:var(--text)] px-[18px] py-2.5 text-sm font-bold text-[color:var(--surface)] transition-colors hover:bg-brand-800"
          >
            <ShoppingCartSimple size={17} weight="fill" />
            <span className="tabular-nums">{formatIDR(cart?.subtotal ?? 0)}</span>
            {count > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-extrabold text-on-brand">
                {count}
              </span>
            )}
          </Link>
          )}

          {ready && customer && (
            <Link
              href="/notifications"
              aria-label={t('notifications.title')}
              className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-brand-50 text-brand-800 transition-transform hover:scale-[1.04]"
            >
              <Bell size={18} weight="fill" />
            </Link>
          )}

          {ready && customer ? (
            <Link
              href="/account"
              aria-label={t('nav.account')}
              className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-brand-50 text-sm font-extrabold text-brand-800 transition-transform hover:scale-[1.04]"
            >
              {customer.fullName?.trim()?.[0]?.toUpperCase() ?? <User size={18} />}
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-full px-4 py-[9px] text-sm font-bold text-brand-700 hover:bg-brand-50"
            >
              {t('nav.signIn')}
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
