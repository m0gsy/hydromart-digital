// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Audit F-7 / F-13 regression suite. Every cart write already answers with the whole
 * priced cart; the app used to discard it and re-`GET`, and the provider re-read the
 * cart on every navigation on top of that. These assertions are on CALL COUNTS — they
 * fail the moment a follow-up read comes back.
 */

const { get, post, put, del, session } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  // Stable identity on purpose: the provider's read is keyed on WHO is signed in, so a
  // fresh object per render would look like a sign-in change and re-read the cart —
  // which is exactly the bug these tests exist to catch.
  session: { customer: { id: 'c1' }, ready: true },
}));

const CART = {
  items: [
    { productId: 'p1', productName: 'Galon 19L', unit: 'galon', quantity: 2, unitPrice: 20_000, lineTotal: 40_000 },
  ],
  subtotal: 40_000,
};
const CART_AFTER = {
  items: [{ ...CART.items[0], quantity: 3, lineTotal: 60_000 }],
  subtotal: 60_000,
};

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, put, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => session }));

import CartPage from '@/app/cart/page';
import { CartProvider } from '@/lib/cart-context';
import { ConfirmProvider } from '@/components/confirm';

/** Only the cart read is scripted; every other GET on the page fails soft. */
function scriptGets() {
  get.mockImplementation((path: string) => {
    if (path === '/orders/api/v1/cart') return Promise.resolve(CART);
    return Promise.reject(new Error('not scripted'));
  });
}

const cartReads = () =>
  get.mock.calls.filter(([path]) => path === '/orders/api/v1/cart').length;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset().mockResolvedValue(CART_AFTER);
  del.mockReset().mockResolvedValue(CART_AFTER);
  scriptGets();
});
afterEach(() => vi.clearAllMocks());

async function renderCart() {
  render(
    <ConfirmProvider>
      <CartProvider>
        <CartPage />
      </CartProvider>
    </ConfirmProvider>,
  );
  // The page renders a skeleton until its own cart read lands.
  await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());
}

describe('cart round-trips', () => {
  it('a quantity change is one round-trip', async () => {
    await renderCart();
    const before = cartReads();

    await userEvent.click(screen.getByLabelText("Increase quantity"));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    // The PUT's own response IS the new cart — nothing may re-read it.
    await waitFor(() => expect(screen.getByText('order.cart.itemCount')).toBeTruthy());
    expect(cartReads()).toBe(before);
  });

  it('removing a line is one round-trip', async () => {
    await renderCart();
    const before = cartReads();

    await userEvent.click(screen.getByLabelText('order.cart.removeAria'));

    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(cartReads()).toBe(before);
  });

  it('adding a recommendation is one round-trip', async () => {
    // The add-on rail needs recommendations; the tap itself is what is measured.
    get.mockImplementation((path: string) => {
      if (path === '/orders/api/v1/cart') return Promise.resolve(CART);
      if (path.startsWith('/recommendations/'))
        return Promise.resolve([{ productId: 'p2', name: 'Galon 12L', score: 1 }]);
      return Promise.reject(new Error('not scripted'));
    });
    post.mockResolvedValue(CART_AFTER);
    await renderCart();
    await waitFor(() => expect(screen.getByLabelText('order.cart.addOnAria')).toBeTruthy());
    const before = cartReads();

    await userEvent.click(screen.getByLabelText('order.cart.addOnAria'));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // This was the worst of the three: POST, then GET, then the provider's refresh.
    expect(cartReads()).toBe(before);
  });

  it('the cart is not re-read on every navigation', async () => {
    // The provider used to depend on `usePathname`, so every route change cost a GET.
    // It depends only on who is signed in now — re-rendering it must read nothing.
    const { rerender } = render(
      <CartProvider>
        <span>child</span>
      </CartProvider>,
    );
    await waitFor(() => expect(cartReads()).toBe(1));

    rerender(
      <CartProvider>
        <span>another route</span>
      </CartProvider>,
    );
    rerender(
      <CartProvider>
        <span>a third route</span>
      </CartProvider>,
    );

    expect(cartReads()).toBe(1);
  });
});
