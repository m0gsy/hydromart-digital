'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowsClockwise, Bell, House, Receipt, SquaresFour, User } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { onPluginEvent } from '@/lib/capacitor';
import { useT } from '@/lib/locale-context';
import { isNativeShell } from '@/lib/platform';
import { consoleHome, isStaff } from '@/lib/roles';

const BAR =
  'fixed inset-x-0 bottom-0 z-30 flex items-end justify-between border-t border-app bg-[color:var(--surface-muted)]/95 px-[22px] pb-[max(14px,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-[8px] sm:hidden';

// Mobile-only bottom tab bar (hidden on sm+, where the top nav carries the links).
// 1f: five slots with an elevated teal "Pesan lagi" (reorder) FAB in the middle.
// ponytail: kept `fixed` (not the spec's `sticky`) — the root layout reserves
// pb-24 on <main> for a fixed bar; sticky would drop it into flow after the
// footer and leave that gap. Same pinned-to-viewport look either way.
/**
 * Whether the soft keyboard is up, on native only. `willShow`/`didHide` rather than one
 * pair or the other: hiding on the announcement keeps the bar from being caught by the
 * keyboard on its way up, and waiting for the keyboard to be fully gone before restoring
 * it keeps the bar from flashing back into the closing animation.
 */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isNativeShell()) return;
    const offShow = onPluginEvent('Keyboard', 'keyboardWillShow', () => setOpen(true));
    const offHide = onPluginEvent('Keyboard', 'keyboardDidHide', () => setOpen(false));
    return () => {
      offShow();
      offHide();
    };
  }, []);
  return open;
}

export function BottomNav() {
  const pathname = usePathname();
  const { t } = useT();
  const { customer, ready } = useAuth();
  const keyboardOpen = useKeyboardOpen();

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
