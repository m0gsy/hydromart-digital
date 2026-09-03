// @vitest-environment jsdom
/*
 * CA-3-17. Every cart line carried a "Stok tersedia" badge, on every render, with no stock
 * data anywhere behind it: the cart response has no stock field and the only stock API is
 * staff-scoped per depot. A badge that is true by construction is not information — the
 * customer reads it as a check somebody made, and it is the first thing they will quote
 * when the depot turns out to be empty.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'c1' }, ready: true }) }));

import { LocaleProvider } from '@/lib/locale-context';
import CartPage from '@/app/cart/page';
import { CartProvider } from '@/lib/cart-context';
import { ConfirmProvider } from '@/components/confirm';

const CART = {
  items: [
    {
      productId: 'p1',
      productName: 'Galon 19L',
      sku: 'AIR-19L',
      unit: 'galon',
      unitPrice: 20_000,
      quantity: 2,
      lineTotal: 40_000,
      isGallon: true,
      imageUrl: null,
    },
  ],
  subtotal: 40_000,
  depotId: null,
  pricingBasis: 'CATALOG',
  reseller: null,
};

beforeEach(() => {
  get
    .mockReset()
    .mockImplementation((p: string) =>
      String(p).startsWith('/orders/api/v1/cart')
        ? Promise.resolve(CART)
        : Promise.reject(new Error('not scripted')),
    );
});
afterEach(() => vi.clearAllMocks());

describe('the cart makes no stock claim it cannot back (CA-3-17)', () => {
  it('renders the line without an availability badge', async () => {
    render(
      <LocaleProvider>
        <ConfirmProvider>
          <CartProvider>
            <CartPage />
          </CartProvider>
        </ConfirmProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());
    expect(screen.queryByText(/stok tersedia/i)).toBeNull();
  });
});
