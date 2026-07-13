'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, CaretDown, Drop, MapPin, ShoppingCartSimple, User } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useLocation } from '@/lib/location-context';
import { useT } from '@/lib/locale-context';
import { formatIDR } from '@/lib/format';
import { canViewDashboard, isStaff } from '@/lib/roles';

export function Nav() {
  const { customer, ready } = useAuth();
  const { count, cart } = useCart();
  const { location } = useLocation();
  const { t } = useT();
  const pathname = usePathname();

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

  return (
    <header className="surface sticky top-0 z-30 border-b border-app">
      <nav className="mx-auto flex h-16 max-w-[1216px] items-center gap-3 px-4 sm:h-[72px] sm:gap-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-extrabold tracking-[-0.02em]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600">
            <Drop size={19} weight="fill" className="text-white" />
          </span>
          <span className="text-[19px]">hydromart</span>
        </Link>

        {/* Location pill — reads the shared delivery location; taps through to the
            home hero where the full selector (geolocation + depot picker) lives.
            ponytail: LocationSelector owns its open state and can't be driven from
            here without editing it (out of scope); route to it instead of cloning
            its depot-fetch. Make it controllable if the dropdown must live in-nav. */}
        <Link
          href="/"
          className="hidden items-center gap-1.5 rounded-full border border-app bg-[color:var(--surface)] px-4 py-[9px] text-[13.5px] font-semibold sm:flex"
        >
          <MapPin size={16} weight="fill" className="text-brand-600" />
          <span className="max-w-[10rem] truncate">
            {location ? location.label : t('home.location.placeholder')}
          </span>
          <CaretDown size={12} className="text-muted" />
        </Link>

        <div className="ml-auto flex items-center gap-1.5">
          {/* primary links — desktop only; mobile uses the bottom tab bar */}
          <div className="hidden items-center gap-1.5 sm:flex">
            {pill('/products', t('nav.shop'))}
            {ready && customer && pill('/orders', t('nav.orders'))}
            {ready && customer && canViewDashboard(customer.role) && pill('/dashboard', t('nav.ops'))}
            {ready && customer && !canViewDashboard(customer.role) && isStaff(customer.role) &&
              pill('/dashboard/orders', t('nav.ops'))}
          </div>

          {/* cart — ink button carrying the running subtotal + teal count badge (1c signature) */}
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
