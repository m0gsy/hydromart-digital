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
    const { container } = render(<AppBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the logo, not a title, on home', () => {
    render(<AppBar />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText('hydromart')).toBeTruthy();
  });

  // The root pages carry no <h1> of their own, so this one is the page's only level-1
  // heading — moving it into a <div> would be a silent accessibility regression.
  it('titles a root screen with an h1', () => {
    pathname = '/orders';
    render(<AppBar />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('nav.orders');
  });

  // The catalog spends its bar on search instead of a title; the page keeps the heading
  // screen-reader-only, so a phone never shows two of them.
  it('renders the catalog search in place of a title, seeded from the URL', () => {
    pathname = '/products';
    search = new URLSearchParams('search=galon');
    render(<AppBar />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect((screen.getByLabelText('shop.catalog.searchLabel') as HTMLInputElement).value).toBe('galon');
  });

  it('keeps the category filter when the app-bar search is submitted', () => {
    pathname = '/products';
    search = new URLSearchParams('category=c1');
    render(<AppBar />);
    const field = screen.getByLabelText('shop.catalog.searchLabel') as HTMLInputElement;
    fireEvent.change(field, { target: { value: ' galon ' } });
    fireEvent.submit(field.closest('form')!);
    expect(push).toHaveBeenCalledWith('/products?search=galon&category=c1');
  });

  it('shows a back control on a pushed screen and no title', () => {
    // A product names itself — the PDP keeps its own heading, so the bar stays untitled.
    pathname = '/products/detail';
    render(<AppBar />);
    expect(screen.getByRole('button', { name: 'common.back' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('titles a pushed screen that has given up its own heading', () => {
    pathname = '/cart';
    render(<AppBar />);
    expect(screen.getByRole('button', { name: 'common.back' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('order.cart.title');
  });

  it('goes back through history when there is history', () => {
    pathname = '/orders/detail';
    window.history.pushState({}, '', '/orders');
    window.history.pushState({}, '', '/orders/detail');
    render(<AppBar />);
    screen.getByRole('button', { name: 'common.back' }).click();
    expect(back).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('walks up to the parent when a deep link left it no history', () => {
    pathname = '/orders/detail';
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true });
    render(<AppBar />);
    screen.getByRole('button', { name: 'common.back' }).click();
    expect(replace).toHaveBeenCalledWith('/orders');
    expect(back).not.toHaveBeenCalled();
  });

  it('hides the cart from staff, who do not shop', () => {
    customer = { role: 'STAFF_DEPOT' };
    render(<AppBar />);
    expect(screen.queryByLabelText('nav.cart')).toBeNull();
  });

  it('badges the cart only when it holds something', () => {
    customer = { role: 'CUSTOMER' };
    const { rerender } = render(<AppBar />);
    expect(screen.getByLabelText('nav.cart').textContent).toBe('');
    count = 3;
    rerender(<AppBar />);
    expect(screen.getByLabelText('nav.cart').textContent).toBe('3');
  });
});
