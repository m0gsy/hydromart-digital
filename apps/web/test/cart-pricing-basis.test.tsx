// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-3-10. `GET /cart` has always answered with `pricingBasis`, and this screen has never
 * repeated it. A shopper with a delivery location set expects the numbers here to be the
 * numbers checkout bills; when order-service could only price the basket from the catalogue
 * they are not, and the first the shopper heard of it was the payment screen.
 *
 * The condition is two-sided on purpose. With NO depot chosen the catalogue price is simply
 * what a shopper who has not said where they are gets, and a warning on every first visit
 * is noise — so the notice is tied to "a depot was chosen AND the answer was CATALOG".
 */

const { get, post, put, del, location } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  location: { current: null as { depotId: string } | null },
}));

const cart = (pricingBasis: 'DEPOT' | 'CATALOG', depotId: string | null) => ({
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
  depotId,
  pricingBasis,
  reseller: null,
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

const NOTICE = 'customerFix.checkout.catalogPricing';

async function renderCart(basis: 'DEPOT' | 'CATALOG', depotId: string | null) {
  location.current = depotId ? { depotId } : null;
  get.mockImplementation((path: string) =>
    path.startsWith('/orders/api/v1/cart')
      ? Promise.resolve(cart(basis, depotId))
      : Promise.reject(new Error('not scripted')),
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

describe('cart says which prices these are (CA-3-10)', () => {
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

  it('warns when a depot was chosen and the prices are still catalogue prices', async () => {
    await renderCart('CATALOG', 'd-1');
    // The summary is rendered twice (rail + sheet), so getAllBy: the claim is that it is
    // there at all, not how many times the one summary appears.
    await waitFor(() => expect(screen.getAllByText(NOTICE).length).toBeGreaterThan(0));
  });

  it('stays quiet when the prices really are the depot’s', async () => {
    await renderCart('DEPOT', 'd-1');
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('stays quiet before the shopper has said where they are', async () => {
    await renderCart('CATALOG', null);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
