// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The basket drew the same grey droplet above three different products — reported from a
 * real phone, 2 September 2026, on the screen where somebody checks they picked the right
 * thing before paying. The photo was never missing from the catalogue: order-service
 * dropped it two adapters upstream, so every line arrived without one.
 *
 * The other two findings from that trip live where they belong: the panel that opened off
 * the left edge in `location-selector.test.tsx`, the pin that could never be captured in
 * `geo.test.ts`.
 */

const { get, post, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: null, setLocation: vi.fn() }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER' }, loading: false }),
}));

import CartPage from '@/app/cart/page';
import { ConfirmProvider } from '@/components/confirm';
import { CartProvider } from '@/lib/cart-context';
import { LocaleProvider } from '@/lib/locale-context';

const line = (over: Record<string, unknown> = {}) => ({
  productId: 'p-1',
  productName: 'Galon Baru + Air 19L',
  sku: 'GAL-19',
  unit: 'Galon',
  unitPrice: 45000,
  quantity: 1,
  lineTotal: 45000,
  isGallon: true,
  imageUrl: 'https://cdn.example.id/galon.jpg',
  ...over,
});

const renderCart = () =>
  render(
    <LocaleProvider>
      <ConfirmProvider>
        <CartProvider>
          <CartPage />
        </CartProvider>
      </ConfirmProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  del.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('the basket shows what the shop showed', () => {
  it('draws each line its own photo', async () => {
    get.mockResolvedValue({
      items: [
        line(),
        line({
          productId: 'p-2',
          productName: 'Air Galon 19L',
          imageUrl: 'https://cdn.example.id/refill.jpg',
        }),
      ],
      subtotal: 53000,
      depotId: null,
      pricingBasis: 'CATALOG',
      reseller: null,
    });
    renderCart();

    // Two products, two different pictures — not one placeholder twice.
    const shots = await screen.findAllByRole('img');
    expect(shots.map((i) => i.getAttribute('src'))).toEqual([
      'https://cdn.example.id/galon.jpg',
      'https://cdn.example.id/refill.jpg',
    ]);
    expect(shots[0]?.getAttribute('alt')).toBe('Galon Baru + Air 19L');
  });

  it('still falls back to the droplet for a product with no photo', async () => {
    get.mockResolvedValue({
      items: [line({ imageUrl: null })],
      subtotal: 45000,
      depotId: null,
      pricingBasis: 'CATALOG',
      reseller: null,
    });
    renderCart();

    await screen.findByText('Galon Baru + Air 19L');
    // A catalogue without a picture is not an error; it is a catalogue without a picture.
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
