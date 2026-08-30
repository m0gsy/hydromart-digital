'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, House, Receipt, SquaresFour, User } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { consoleHome, isStaff } from '@/lib/roles';
import { useKeyboardOpen } from '@/lib/use-keyboard';

const BAR =
  'fixed inset-x-0 bottom-0 z-30 flex items-end justify-between border-t border-app bg-[color:var(--surface-muted)]/95 px-[22px] pb-[max(14px,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] pt-2.5 backdrop-blur-[8px] sm:hidden';

// Mobile-only bottom tab bar (hidden on sm+, where the top nav carries the links).
// Four slots, and only on the four root screens — `AppShell` does not render this on a
// pushed screen, where the app bar's back chevron is the whole navigation model.
//
// The fifth slot used to be an elevated "Pesan lagi" FAB pointing at `/products`, the same
// href as the Belanja tab beside it. It bought an accent and cost a quarter of the bar;
// reordering itself is unaffected, since "Beli lagi" is the first rail on an authed home
// and the first block on /orders. A FAB earns the slot back the day it opens a
// quick-reorder sheet instead of a duplicate link.
// ponytail: kept `fixed` (not the spec's `sticky`) — the root layout reserves
// pb-24 on <main> for a fixed bar; sticky would drop it into flow after the
// footer and leave that gap. Same pinned-to-viewport look either way.
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useT();
  const { customer, ready } = useAuth();
  const keyboardOpen = useKeyboardOpen();

  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  /*
   * Prefetch on INTENT, not on sight.
   *
   * Next's App Router prefetches a <Link> as soon as it enters the viewport. This bar is
   * always in the viewport, so every page load pulled the RSC payload and chunks for all
   * four tabs whether or not anyone went there. Measured against production with Playwright
   * (Moto G4 emulation, 4 loads): the home page made 44 requests and 18 of them — 41% — were
   * prefetches of other routes, 13 of those from this bar. Every visitor paid for them in
   * data, on every page.
   *
   * `prefetch={false}` alone would be the wrong trade: tabs ARE the most likely next
   * destination, and losing the warm cache is exactly the navigation this bar exists for. So
   * the prefetch moves to the moment intent appears — `onTouchStart` fires roughly 100ms
   * before the tap completes, and `onMouseEnter` covers the desktop rail. Warm when it
   * matters, unpaid when it does not.
   *
   * `router.prefetch` is idempotent and cached by Next, so a scrolling thumb that brushes
   * three tabs costs three prefetches once, not once per touch.
   */
  const warm = (href: string) => () => router.prefetch(href);

  const tab = (href: string, label: string, icon: Icon) => {
    const on = active(href);
    const IconCmp = icon;
    return (
      <Link
        key={href}
        href={href}
        prefetch={false}
        onTouchStart={warm(href)}
        onMouseEnter={warm(href)}
        aria-current={on ? 'page' : undefined}
        className={
          'flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-extrabold transition-colors ' +
          (on ? 'text-brand-600' : 'text-muted')
        }
      >
        <IconCmp size={22} weight={on ? 'fill' : 'regular'} />
        {label}
      </Link>
    );
  };

  // Android shrinks the WebView for the keyboard, which leaves this bar pinned directly
  // on top of it — covering the field being typed into on `/verify` and `/checkout`,
  // where the bar has nothing to offer anyway. Gone while typing, back afterwards.
  if (keyboardOpen) return null;

  // Staff accounts don't shop: no shop/reorder/cart tabs, just their console.
  if (ready && customer != null && isStaff(customer.role)) {
    return (
      <nav className={BAR} aria-label="Navigasi utama">
        {tab(consoleHome(customer.role), t('nav.ops'), SquaresFour)}
        {tab('/notifications', t('notifications.title'), Bell)}
        {tab('/account', t('nav.account'), User)}
      </nav>
    );
  }

  return (
    <nav className={BAR} aria-label="Navigasi utama">
      {tab('/', t('nav.home'), House)}
      {tab('/products', t('nav.shop'), SquaresFour)}
      {tab('/orders', t('nav.orders'), Receipt)}
      {tab('/account', t('nav.account'), User)}
    </nav>
  );
}
