import { describe, expect, it } from 'vitest';

import { pageAnimation } from '@/components/page-transition';

/**
 * The direction a navigation is animated in is an IA question, not a styling one, so it is
 * decided by a pure function and tested here rather than watched in a browser.
 */
describe('pageAnimation', () => {
  it('fades the first paint, which has no previous screen', () => {
    expect(pageAnimation(null, '/products')).toBe('fadeUp');
  });

  it('slides in from the right going from a tab into a screen pushed off it', () => {
    expect(pageAnimation('/products', '/products/detail')).toBe('slideInRight');
    expect(pageAnimation('/account', '/rewards')).toBe('slideInRight');
  });

  it('slides in from the left coming back out to a tab', () => {
    expect(pageAnimation('/cart', '/products')).toBe('slideInLeft');
    expect(pageAnimation('/rewards', '/account')).toBe('slideInLeft');
  });

  // Both directions exist between two pushed screens and the pathnames cannot tell them
  // apart, so guessing would animate backwards half the time.
  it('does not guess a direction between two pushed screens', () => {
    expect(pageAnimation('/orders/detail', '/orders/detail/review')).toBe('fadeUp');
    expect(pageAnimation('/orders/detail/review', '/orders/detail')).toBe('fadeUp');
  });

  it('leaves tab-to-tab and the auth screens alone', () => {
    expect(pageAnimation('/products', '/orders')).toBe('fadeUp');
    expect(pageAnimation('/login', '/verify')).toBe('fadeUp');
    expect(pageAnimation('/verify', '/')).toBe('fadeUp');
  });

  // A re-render on the same route is not a navigation.
  it('treats staying put as no movement', () => {
    expect(pageAnimation('/products', '/products')).toBe('fadeUp');
  });

  // `trailingSlash: true` in the exported build hands the router both spellings.
  it('reads a trailing slash as the same screen', () => {
    expect(pageAnimation('/products/', '/cart/')).toBe('slideInRight');
  });
});
