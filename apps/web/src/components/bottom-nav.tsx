'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowsClockwise, House, Receipt, SquaresFour, User } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { useT } from '@/lib/locale-context';

// Mobile-only bottom tab bar (hidden on sm+, where the top nav carries the links).
// 1f: five slots with an elevated teal "Pesan lagi" (reorder) FAB in the middle.
// ponytail: kept `fixed` (not the spec's `sticky`) — the root layout reserves
// pb-24 on <main> for a fixed bar; sticky would drop it into flow after the
// footer and leave that gap. Same pinned-to-viewport look either way.
export function BottomNav() {
  const pathname = usePathname();
  const { t } = useT();

  // The ops console has its own mobile tab bar (OpsBottomNav in dashboard/layout).
  if (pathname.startsWith('/dashboard')) return null;

  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const tab = (href: string, label: string, icon: Icon) => {
    const on = active(href);
    const IconCmp = icon;
    return (
      <Link
        key={href}
        href={href}
        aria-current={on ? 'page' : undefined}
        className={
          'flex flex-1 flex-col items-center gap-1 text-[10px] font-extrabold transition-colors ' +
          (on ? 'text-brand-600' : 'text-muted')
        }
      >
        <IconCmp size={22} weight={on ? 'fill' : 'regular'} />
        {label}
      </Link>
    );
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-end justify-between border-t border-app bg-[color:var(--surface-muted)]/95 px-[22px] pb-[max(14px,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-[8px] sm:hidden"
      aria-label="Navigasi utama"
    >
      {tab('/', t('nav.home'), House)}
      {tab('/products', t('nav.shop'), SquaresFour)}

      {/* Center reorder FAB — elevated above the bar */}
      <Link
        href="/products"
        className="flex flex-1 flex-col items-center gap-1 text-[10px] font-extrabold text-brand-600"
      >
        <span className="-mt-[26px] flex h-[52px] w-[52px] items-center justify-center rounded-full bg-brand-600 shadow-[0_8px_18px_rgba(12,151,172,0.35)]">
          <ArrowsClockwise size={24} weight="fill" className="text-white" />
        </span>
        {t('order.detail.reorder')}
      </Link>

      {tab('/orders', t('nav.orders'), Receipt)}
      {tab('/account', t('nav.account'), User)}
    </nav>
  );
}
