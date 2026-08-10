/**
 * Which chrome a customer route wears. This is the app's information architecture, in one
 * place — the alternative is a chrome decision scattered across 26 page files, where the
 * next new route silently inherits whatever the shell happens to render.
 *
 * Three kinds, and the difference between them is navigational, not decorative:
 *
 * - `root`   the four tab destinations. App bar + tab bar. You are somewhere you can leave
 *            sideways.
 * - `pushed` everything reached from a root screen. Back chevron, no tab bar. One way out,
 *            and it is backwards.
 * - `bare`   auth and the two public legal pages. No chrome at all: nothing to navigate to
 *            until you are signed in, and `/hapus-akun` is opened by Play reviewers who are
 *            not signed in at all.
 *
 * Pure and synchronous, so the whole IA is exercised in `test/screen-chrome.test.ts` rather
 * than in a browser. The test asserts every customer route has an entry, which is what stops
 * a new route from quietly defaulting to the wrong kind.
 */

export type ChromeKind = 'root' | 'pushed' | 'bare';

export interface Chrome {
  kind: ChromeKind;
  /**
   * Locale key for the app-bar title. A pushed screen only gets one once its own `<h1>` is
   * gone from the page below `sm:`, so the heading is never rendered twice — which is why
   * they arrive one phase at a time rather than all at once.
   */
  titleKey?: string;
  /** Where back goes when there is no history to go back to (deep links land like that). */
  backHref: string;
}

/** The tab bar, and the only screens that show it. */
export const ROOT_TABS = ['/', '/products', '/orders', '/account'] as const;

const ROOT: Record<string, string | undefined> = {
  '/': undefined, // the logo lockup stands in for a title on home
  '/products': 'nav.shop',
  '/orders': 'nav.orders',
  '/account': 'nav.account',
};

/** Pushed screens whose page heading has already moved up here. */
const PUSHED: Record<string, string> = {
  '/cart': 'order.cart.title',
  '/checkout': 'order.checkout.title',
};

const BARE = new Set(['/login', '/register', '/verify', '/hapus-akun', '/kebijakan-privasi']);

/**
 * Where the back chevron goes when `history.length` says there is nothing behind us. Only
 * routes whose parent is not `/` need an entry; everything else falls back to home.
 *
 * This matters more than it looks: a push notification opens the app directly on
 * `/orders/detail`, with one entry in history. Calling `router.back()` there exits the app.
 */
const BACK: Record<string, string> = {
  '/products/detail': '/products',
  '/orders/detail': '/orders',
  '/orders/detail/review': '/orders/detail',
  '/account/edit': '/account',
  '/addresses': '/account',
  '/favorites': '/account',
  '/subscriptions': '/account',
  '/vouchers': '/account',
  '/referral': '/account',
  '/rewards': '/account',
  '/help': '/account',
  '/notifications': '/account',
  '/checkout': '/cart',
  '/cart': '/products',
};

/**
 * `trailingSlash: true` in the exported build means the router can hand us `/products/`
 * where the dev server hands us `/products`. Both name the same screen.
 */
function normalise(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

export function screenChrome(pathname: string): Chrome {
  const path = normalise(pathname);

  if (path in ROOT) return { kind: 'root', titleKey: ROOT[path], backHref: '/' };
  if (BARE.has(path)) return { kind: 'bare', backHref: '/' };

  return { kind: 'pushed', titleKey: PUSHED[path], backHref: BACK[path] ?? '/' };
}
