import { describe, expect, it } from 'vitest';

import { ROOT_TABS, screenChrome } from '@/lib/screen-chrome';

/**
 * Every customer route, and the chrome it is supposed to wear. This list is the point of
 * the test: a route added to the app without a decision here shows up as a failure rather
 * than as a screen that silently inherits the wrong navigation.
 */
const ROUTES: Record<string, 'root' | 'pushed' | 'bare'> = {
  '/': 'root',
  '/products': 'root',
  '/orders': 'root',
  '/account': 'root',

  '/products/detail': 'pushed',
  '/orders/detail': 'pushed',
  '/orders/detail/review': 'pushed',
  '/cart': 'pushed',
  '/checkout': 'pushed',
  '/account/edit': 'pushed',
  '/addresses': 'pushed',
  '/rewards': 'pushed',
  '/subscriptions': 'pushed',
  '/vouchers': 'pushed',
  '/promo': 'pushed',
  '/referral': 'pushed',
  '/favorites': 'pushed',
  '/notifications': 'pushed',
  '/help': 'pushed',
  '/waralaba': 'pushed',
  '/resellers': 'pushed',

  '/login': 'bare',
  '/register': 'bare',
  '/verify': 'bare',
  '/hapus-akun': 'bare',
  '/kebijakan-privasi': 'bare',
};

describe('screenChrome', () => {
  it.each(Object.entries(ROUTES))('%s is %s', (path, kind) => {
    expect(screenChrome(path).kind).toBe(kind);
  });

  it('gives the four tabs the root chrome and nothing else', () => {
    for (const tab of ROOT_TABS) expect(screenChrome(tab).kind).toBe('root');
    expect(ROOT_TABS).toHaveLength(4);
    const roots = Object.entries(ROUTES).filter(([, kind]) => kind === 'root');
    expect(roots.map(([path]) => path).sort()).toEqual([...ROOT_TABS].sort());
  });

  it('titles the three root screens that are not home', () => {
    expect(screenChrome('/').titleKey).toBeUndefined();
    expect(screenChrome('/products').titleKey).toBe('nav.shop');
    expect(screenChrome('/orders').titleKey).toBe('nav.orders');
    expect(screenChrome('/account').titleKey).toBe('nav.account');
  });

  // `trailingSlash: true` in the exported build: the same screen arrives spelled both ways.
  it.each(Object.keys(ROUTES).filter((p) => p !== '/'))('%s/ resolves like %s', (path) => {
    expect(screenChrome(`${path}/`)).toEqual(screenChrome(path));
  });

  describe('back target when there is no history — a deep link lands like that', () => {
    it('walks up to the parent screen, not to home', () => {
      expect(screenChrome('/orders/detail').backHref).toBe('/orders');
      expect(screenChrome('/orders/detail/review').backHref).toBe('/orders/detail');
      expect(screenChrome('/products/detail').backHref).toBe('/products');
      expect(screenChrome('/checkout').backHref).toBe('/cart');
      expect(screenChrome('/account/edit').backHref).toBe('/account');
    });

    it('sends the account sub-screens back to the account tab', () => {
      for (const path of ['/addresses', '/rewards', '/vouchers', '/referral', '/help']) {
        expect(screenChrome(path).backHref).toBe('/account');
      }
    });

    it('falls back to home for anything unmapped', () => {
      expect(screenChrome('/promo').backHref).toBe('/');
      expect(screenChrome('/waralaba').backHref).toBe('/');
      expect(screenChrome('/tidak-ada-rute-ini').backHref).toBe('/');
    });
  });

  it('treats an unknown route as pushed, so it keeps a way back', () => {
    expect(screenChrome('/rute-baru-yang-belum-dipetakan').kind).toBe('pushed');
  });
});
