'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Bell, MagnifyingGlass, ShoppingCartSimple } from '@phosphor-icons/react';

import { LocationSelector } from '@/components/location-selector';
import { BrandMark, Input } from '@/components/ui';
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
 * `pt-[var(--safe-area-inset-top,env(safe-area-inset-top))]` is load-bearing, not polish. `targetSdkVersion = 36` means
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
    <header className="surface sticky top-0 z-30 border-b border-app pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] sm:hidden">
      <div className="flex h-14 items-center gap-2 px-4">
        {chrome.kind === 'pushed' ? (
          <>
            <button
              type="button"
              onClick={goBack}
              aria-label={t('common.back')}
              className="-ml-2 flex h-11 w-11 flex-none items-center justify-center rounded-full text-[color:var(--text)] transition-colors hover:bg-brand-50"
            >
              <ArrowLeft size={22} />
            </button>
            {/* Only once the page below has stopped rendering its own — the titles arrive
                one screen at a time, with the phase that rebuilds that screen. */}
            {chrome.titleKey && (
              <h1 className="truncate text-[17px] font-extrabold tracking-[-0.02em]">
                {t(chrome.titleKey)}
              </h1>
            )}
          </>
        ) : chrome.search ? (
          // The catalog spends its app bar on the search field: title + subtitle + a
          // full-width pill were ~120px of the first screen, and the pill is what the
          // thumb was reaching for. The page keeps the heading, screen-reader only.
          <Suspense fallback={<div className="h-10 flex-1" />}>
            <SearchField />
          </Suspense>
        ) : chrome.titleKey ? (
          // Root screens own the page title now, so the page below no longer repeats it.
          <h1 className="truncate text-[19px] font-extrabold tracking-[-0.02em]">
            {t(chrome.titleKey)}
          </h1>
        ) : staff ? (
          <Link href="/">
            <BrandMark />
          </Link>
        ) : (
          /*
           * G6. On a phone the delivery location had no home in the chrome at all. The
           * `sm:` nav has carried this exact control for a while; the app bar that replaces
           * it below that breakpoint carried the wordmark instead, so the only way to set a
           * location was to scroll the home page down to the "Depot terdekat" card — which
           * is also the only place that tells you your location is wrong.
           *
           * It replaces the brand rather than joining it, and that is width, not taste. At
           * 320px the row has 320 − 32 (px-4) − 44 (bell) − 44 (cart) − gaps ≈ 186px for
           * this slot; the lockup is a 36px circle plus a nine-character wordmark at 19px,
           * which eats most of it on its own. Both would leave the chip an ellipsis, and an
           * ellipsis is not a control. The mark is one tap away on every other surface —
           * this is the home screen, where the brand is the least new information present.
           *
           * Staff keep the wordmark: the picker sets a CUSTOMER delivery location, and the
           * depot a staff member works from is their assignment, not their choice.
           */
          <LocationSelector compact />
        )}

        <div className="ml-auto flex flex-none items-center gap-1.5">
          {ready && customer && (
            <Link
              href="/notifications"
              aria-label={t('notifications.title')}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-800"
            >
              <Bell size={18} weight="fill" />
            </Link>
          )}

          {/* The cart is an app-bar action rather than a fifth tab: `/cart` is behind
              RequireAuth, so a cart tab is a dead tab for anyone not signed in.

              prefetch={false}: the cart is opened deliberately, never browsed into, and it
              sat in the app bar of EVERY page. Measured against production (Playwright, Moto
              G4 emulation): this one icon accounted for 5 of the home page's 44 requests —
              the /cart RSC payload plus its chunks — pulled for every visitor on every
              screen, most of whom never open it. No intent handler here, unlike the tab bar:
              there is no navigation flow this warms, and /cart is small enough that a cold
              open is not felt. */}
          {!staff && (
            <Link
              href="/cart"
              prefetch={false}
              aria-label={t('nav.cart')}
              className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--text)] text-[color:var(--surface)]"
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

/**
 * The catalog's search, living in the app bar. Seeded from the URL because the URL is the
 * catalog's source of truth for its filters — come back to the screen, or arrive from the
 * home hero, and the field already reads what is filtered. Submitting keeps the category:
 * searching within a category is the common case, and dropping it silently is worse than
 * an extra tap to clear it.
 */
function SearchField() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useT();

  const query = params.get('search')?.trim() ?? '';
  const category = params.get('category') ?? '';
  const [value, setValue] = useState(query);

  useEffect(() => setValue(query), [query]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (value.trim()) p.set('search', value.trim());
    if (category) p.set('category', category);
    router.push(`/products${p.toString() ? `?${p.toString()}` : ''}`);
  }

  return (
    <form onSubmit={submit} className="relative min-w-0 flex-1">
      <MagnifyingGlass
        size={17}
        className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-brand-600"
      />
      <Input
        type="search"
        // Named, so the browser can autofill and remember it — an unnamed form field is
        // also what Chrome flags in the issues panel.
        name="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('shop.catalog.searchPlaceholder')}
        aria-label={t('shop.catalog.searchLabel')}
        className="surface h-10 !rounded-full border-app pl-[38px] pr-3.5 text-[14px]"
      />
    </form>
  );
}
