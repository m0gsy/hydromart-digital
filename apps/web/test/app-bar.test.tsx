// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/';
let customer: { role: string; fullName?: string } | null = null;
let count = 0;
const back = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ back, replace }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer, ready: true }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ count }) }));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));

import { AppBar } from '@/components/app-bar';

beforeEach(() => {
  pathname = '/';
  customer = null;
  count = 0;
  back.mockClear();
  replace.mockClear();
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

  it('shows a back control on a pushed screen and no title', () => {
    pathname = '/rewards';
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
