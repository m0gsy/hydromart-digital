// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Item 5: checkout applies the automatic promos, so the cart must show the same total
 * instead of a higher one that quietly drops at the button.
 */

const { get, post, put, del, location } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  location: { current: null as { depotId: string } | null },
}));

const cart = (promo: { savings: number } | null) => ({
  items: [
    {
      productId: 'p1',
      productName: 'Galon 19L',
      unit: 'galon',
      quantity: 2,
      unitPrice: 20_000,
      lineTotal: 40_000,
    },
  ],
  subtotal: 40_000,
  depotId: 'd-1',
  pricingBasis: 'DEPOT',
  reseller: null,
  promo: promo && { subtotal: 40_000 - promo.savings, savings: promo.savings, lines: [], shippingFeeOverride: null },
});

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, put, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: location.current }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c1' }, ready: true }),
}));

import CartPage from '@/app/cart/page';
import { CartProvider } from '@/lib/cart-context';
import { ConfirmProvider } from '@/components/confirm';

async function renderCart(promo: { savings: number } | null) {
  location.current = { depotId: 'd-1' };
  get.mockImplementation((path: string) =>
    path.startsWith('/orders/api/v1/cart') ? Promise.resolve(cart(promo)) : Promise.reject(new Error('not scripted')),
  );
  render(
    <ConfirmProvider>
      <CartProvider>
        <CartPage />
      </CartProvider>
    </ConfirmProvider>,
  );
  await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());
}

describe('cart shows the automatic promo (item 5)', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    del.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
    location.current = null;
  });

  it('shows a promo line and a total net of it', async () => {
    await renderCart({ savings: 8_000 });
    await waitFor(() => expect(screen.getAllByText('order.cart.promoDiscount').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/32\.000/).length).toBeGreaterThan(0); // estimated total
  });

  it('shows no promo line when none applies', async () => {
    await renderCart(null);
    expect(screen.queryByText('order.cart.promoDiscount')).toBeNull();
  });
});
