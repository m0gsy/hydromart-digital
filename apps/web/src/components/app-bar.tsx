'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Bell, Drop, ShoppingCartSimple } from '@phosphor-icons/react';

import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { useT } from '@/lib/locale-context';
import { isStaff } from '@/lib/roles';
import { screenChrome } from '@/lib/screen-chrome';

/**
 * The phone app bar. Replaces `Nav` below `sm:` — `Nav` keeps every width above it, so this
 * is a breakpoint swap in CSS, not a platform branch: the same markup ships to the browser
 * and to the WebView, and a narrow desktop window gets the app layout too. That was the
 * deliberate call; the alternative is two code paths per screen forever.
 *
 * `pt-[env(safe-area-inset-top)]` is load-bearing, not polish. `targetSdkVersion = 36` means
 * Android 15 enforces edge-to-edge and ignores `StatusBar.setOverlaysWebView(false)`, so on
 * a current phone the app is already drawing under the status bar. Nothing else in the app
 * reads the top inset.
 */
export function AppBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useT();
  const { customer, ready } = useAuth();
  const { count } = useCart();

  const chrome = screenChrome(pathname);
  if (chrome.kind === 'bare') return null;

  const staff = ready && customer != null && isStaff(customer.role);

  // A deep link from a notification arrives with one history entry, and `back()` on that is
  // "exit the app". The map's parent route is the honest destination instead.
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.replace(chrome.backHref);
  };

  return (
    <header className="surface sticky top-0 z-30 border-b border-app pt-[env(safe-area-inset-top)] sm:hidden">
      <div className="flex h-14 items-center gap-2 px-4">
        {chrome.kind === 'pushed' ? (
          <button
            type="button"
            onClick={goBack}
            aria-label={t('common.back')}
            className="-ml-2 flex h-10 w-10 flex-none items-center justify-center rounded-full text-[color:var(--text)] transition-colors hover:bg-brand-50"
          >
            <ArrowLeft size={22} />
          </button>
        ) : chrome.titleKey ? (
          // Root screens own the page title now, so the page below no longer repeats it.
          <h1 className="truncate text-[19px] font-extrabold tracking-[-0.02em]">
            {t(chrome.titleKey)}
          </h1>
        ) : (
          <Link href="/" className="flex items-center gap-2.5 font-extrabold tracking-[-0.02em]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600">
              <Drop size={19} weight="fill" className="text-white" />
            </span>
            <span className="text-[19px]">hydromart</span>
          </Link>
        )}

        {/* Pushed screens keep their own <h1> for now; their titles move up here in the
            phase that rebuilds each screen, so the heading is never rendered twice. */}

        <div className="ml-auto flex flex-none items-center gap-1.5">
          {ready && customer && (
            <Link
              href="/notifications"
              aria-label={t('notifications.title')}
              className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-brand-50 text-brand-800"
            >
              <Bell size={18} weight="fill" />
            </Link>
          )}

          {/* The cart is an app-bar action rather than a fifth tab: `/cart` is behind
              RequireAuth, so a cart tab is a dead tab for anyone not signed in. */}
          {!staff && (
            <Link
              href="/cart"
              aria-label={t('nav.cart')}
              className="relative flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[color:var(--text)] text-[color:var(--surface)]"
            >
              <ShoppingCartSimple size={18} weight="fill" />
              {count > 0 && (
                <span className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-extrabold text-on-brand">
                  {count}
                </span>
              )}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
