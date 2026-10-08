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

type TestPromo = { savings: number; orderDiscount?: number; gifts?: { productId: string; productName: string; quantity: number }[] };

const cart = (promo: TestPromo | null) => ({
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
  promo: promo && {
    subtotal: 40_000 - promo.savings,
    savings: promo.savings,
    lines: [],
    shippingFeeOverride: null,
    orderDiscount: promo.orderDiscount,
    gifts: promo.gifts,
  },
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
import { formatIDR } from '@/lib/format';
import { CartProvider } from '@/lib/cart-context';
import { ConfirmProvider } from '@/components/confirm';

async function renderCart(promo: TestPromo | null) {
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

  it('shows an order discount, the gifts, and a total net of the discount', async () => {
    await renderCart({
      savings: 0,
      orderDiscount: 5_000,
      gifts: [{ productId: 'g1', productName: 'Botol 600ml', quantity: 2 }],
    });
    await waitFor(() => expect(screen.getAllByText('order.cart.orderDiscount').length).toBeGreaterThan(0));
    expect(screen.getAllByText('order.cart.giftLine').length).toBeGreaterThan(0);
    expect(screen.getAllByText('order.cart.giftNote').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/35\.000/).length).toBeGreaterThan(0); // 40.000 - 5.000
  });

  it('never takes more off than the goods', async () => {
    await renderCart({ savings: 0, orderDiscount: 90_000 });
    await waitFor(() => expect(screen.getAllByText('order.cart.orderDiscount').length).toBeGreaterThan(0));
    // The estimated total floors at zero rather than going negative.
    expect(screen.getAllByText(formatIDR(0)).length).toBeGreaterThan(0);
    expect(screen.queryByText(formatIDR(-50_000))).toBeNull();
  });
});
