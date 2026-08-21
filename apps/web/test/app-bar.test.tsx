// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/';
let search = new URLSearchParams();
let customer: { role: string; fullName?: string } | null = null;
let count = 0;
const back = vi.fn();
const replace = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back, replace, push }),
  useSearchParams: () => search,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer, ready: true }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ count }) }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));

import { AppBar } from '@/components/app-bar';
import { LocationProvider } from '@/lib/location-context';

/*
 * G6 put the location chip in the home branch of the bar, and that chip reads
 * `useLocation()`, which THROWS rather than returning null when no provider is above it.
 * Measured before this wrapper existed: two tests in this file died with
 * "useLocation must be used within <LocationProvider>" — the two that render the home
 * branch, not the whole file, since the other screens never reach that branch.
 */
const renderBar = () => render(<AppBar />, { wrapper: LocationProvider });

beforeEach(() => {
  pathname = '/';
  search = new URLSearchParams();
  customer = null;
  count = 0;
  back.mockClear();
  replace.mockClear();
  push.mockClear();
  window.history.pushState({}, '', '/');
});

describe('AppBar', () => {
  it('renders nothing on a bare screen', () => {
    pathname = '/login';
    const { container } = renderBar();
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * G6. Home used to spend this slot on the wordmark, and the phone had nowhere in its
   * chrome to set a delivery location at all — the `sm:` nav has carried this control for a
   * while, but the bar that replaces it below that breakpoint did not. Setting a location
   * meant scrolling the home page down to the "Depot terdekat" card.
   */
  it('spends the home slot on the location chip, not the wordmark', () => {
    renderBar();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText('home.location.placeholder')).toBeTruthy();
    expect(screen.queryByText('hydromart')).toBeNull();
  });

  // The picker sets a CUSTOMER delivery location; the depot a staff member works from is
  // their assignment, not something to shop around for.
  it('keeps the wordmark for staff', () => {
    customer = { role: 'STAFF_DEPOT' };
    renderBar();
    expect(screen.getByText('hydromart')).toBeTruthy();
    expect(screen.queryByText('home.location.placeholder')).toBeNull();
  });

  // The root pages carry no <h1> of their own, so this one is the page's only level-1
  // heading — moving it into a <div> would be a silent accessibility regression.
  it('titles a root screen with an h1', () => {
    pathname = '/orders';
    renderBar();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('nav.orders');
  });

  // The catalog spends its bar on search instead of a title; the page keeps the heading
  // screen-reader-only, so a phone never shows two of them.
  it('renders the catalog search in place of a title, seeded from the URL', () => {
    pathname = '/products';
    search = new URLSearchParams('search=galon');
    renderBar();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect((screen.getByLabelText('shop.catalog.searchLabel') as HTMLInputElement).value).toBe('galon');
  });

  it('keeps the category filter when the app-bar search is submitted', () => {
    pathname = '/products';
    search = new URLSearchParams('category=c1');
    renderBar();
    const field = screen.getByLabelText('shop.catalog.searchLabel') as HTMLInputElement;
    fireEvent.change(field, { target: { value: ' galon ' } });
    fireEvent.submit(field.closest('form')!);
    expect(push).toHaveBeenCalledWith('/products?search=galon&category=c1');
  });

  it('shows a back control on a pushed screen and no title', () => {
    // A product names itself — the PDP keeps its own heading, so the bar stays untitled.
    pathname = '/products/detail';
    renderBar();
    expect(screen.getByRole('button', { name: 'common.back' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('titles a pushed screen that has given up its own heading', () => {
    pathname = '/cart';
    renderBar();
    expect(screen.getByRole('button', { name: 'common.back' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('order.cart.title');
  });

  it('goes back through history when there is history', () => {
    pathname = '/orders/detail';
    window.history.pushState({}, '', '/orders');
    window.history.pushState({}, '', '/orders/detail');
    renderBar();
    screen.getByRole('button', { name: 'common.back' }).click();
    expect(back).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('walks up to the parent when a deep link left it no history', () => {
    pathname = '/orders/detail';
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true });
    renderBar();
    screen.getByRole('button', { name: 'common.back' }).click();
    expect(replace).toHaveBeenCalledWith('/orders');
    expect(back).not.toHaveBeenCalled();
  });

  it('hides the cart from staff, who do not shop', () => {
    customer = { role: 'STAFF_DEPOT' };
    renderBar();
    expect(screen.queryByLabelText('nav.cart')).toBeNull();
  });

  it('badges the cart only when it holds something', () => {
    customer = { role: 'CUSTOMER' };
    const { rerender } = renderBar();
    expect(screen.getByLabelText('nav.cart').textContent).toBe('');
    count = 3;
    rerender(<AppBar />);
    expect(screen.getByLabelText('nav.cart').textContent).toBe('3');
  });
});
