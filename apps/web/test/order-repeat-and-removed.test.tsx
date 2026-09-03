// @vitest-environment jsdom
/*
 * CA-3-28 / CA-3-23 — two silences on either side of the same basket.
 *
 * "Pesan lagi" skips any line whose product is gone or deactivated. The server has always
 * done that, quietly, and the screen said "Item ditambahkan ke keranjang" either way —
 * including when NOTHING was added. The customer landed on a cart that had not changed,
 * with a green toast saying it had.
 *
 * The cart itself had the mirror image: a line whose product was delisted vanished between
 * one visit and the next, and the only sign was a total that had gone down.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, toast, push } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, put: vi.fn(), del: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null, ready: true }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/orders/detail',
  useSearchParams: () => new URLSearchParams('id=o-1'),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { CartProvider } from '@/lib/cart-context';
import { ConfirmProvider } from '@/components/confirm';
import OrderDetailPage from '@/app/orders/detail/page';
import CartPage from '@/app/cart/page';

const emptyCart = {
  items: [],
  removed: [],
  subtotal: 0,
  depotId: null,
  pricingBasis: 'CATALOG',
  reseller: null,
};

const ORDER = {
  id: 'o-1',
  orderNumber: 'HM-0001',
  status: 'COMPLETED',
  createdAt: '2026-08-10T03:00:00.000Z',
  total: 40_000,
  subtotal: 40_000,
  deliveryFee: 0,
  discount: 0,
  paymentMethod: 'CASH',
  history: [],
  items: [
    {
      productId: 'p-1',
      productName: 'Galon 19L',
      quantity: 1,
      unitPrice: 20_000,
      lineTotal: 20_000,
    },
    {
      productId: 'p-2',
      productName: 'Botol 600ml',
      quantity: 1,
      unitPrice: 20_000,
      lineTotal: 20_000,
    },
  ],
};

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ConfirmProvider>
      <CartProvider>{children}</CartProvider>
    </ConfirmProvider>
  </LocaleProvider>
);

beforeEach(() => {
  // `useQueryParam` reads `window.location`, not Next's mocked `useSearchParams`.
  window.history.replaceState({}, '', '/orders/detail?id=o-1');
  toast.mockReset();
  push.mockReset();
  post.mockReset();
  get.mockReset().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/orders/api/v1/orders/o-1')) return Promise.resolve(ORDER);
    if (u.includes('/cart')) return Promise.resolve(emptyCart);
    if (u.includes('/payments'))
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 20 });
    return Promise.resolve([]);
  });
});
afterEach(() => vi.clearAllMocks());

const clickRepeat = async () => {
  const user = userEvent.setup();
  await screen.findAllByText(/HM-0001/);
  await user.click(screen.getByRole('button', { name: /pesan lagi/i }));
};

describe('"Pesan lagi" reports what actually happened (CA-3-28)', () => {
  it('refuses to claim success when nothing could be re-added', async () => {
    // Both products are delisted: the server answers with a cart that has neither.
    post.mockResolvedValue(emptyCart);

    render(<OrderDetailPage />, { wrapper: Wrap });
    await clickRepeat();

    await waitFor(() => expect(screen.getByText(/tidak ada barang pesanan ini/i)).toBeTruthy());
    expect(toast).not.toHaveBeenCalled();
    // ...and it does not march the customer off to a cart that did not change.
    expect(push).not.toHaveBeenCalled();
  });

  it('says how many were left behind when only some came back', async () => {
    post.mockResolvedValue({
      ...emptyCart,
      items: [
        {
          productId: 'p-1',
          productName: 'Galon 19L',
          quantity: 1,
          unitPrice: 20_000,
          lineTotal: 20_000,
        },
      ],
      subtotal: 20_000,
    });

    render(<OrderDetailPage />, { wrapper: Wrap });
    await clickRepeat();

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls[0]![0])).toMatch(/1 barang tidak lagi dijual/);
    expect(push).toHaveBeenCalledWith('/cart');
  });

  it('says the plain thing when everything came back', async () => {
    post.mockResolvedValue({
      ...emptyCart,
      items: ORDER.items.map((i) => ({ ...i })),
      subtotal: 40_000,
    });

    render(<OrderDetailPage />, { wrapper: Wrap });
    await clickRepeat();

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(String(toast.mock.calls[0]![0])).not.toMatch(/tidak lagi dijual/);
    expect(push).toHaveBeenCalledWith('/cart');
  });
});

describe('the cart names the line it dropped (CA-3-23)', () => {
  it('says which product is gone rather than quietly shrinking the total', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('/cart')
        ? Promise.resolve({
            ...emptyCart,
            items: [
              {
                productId: 'p-1',
                productName: 'Galon 19L',
                sku: 'A',
                unit: 'galon',
                unitPrice: 20_000,
                quantity: 1,
                lineTotal: 20_000,
                isGallon: true,
                imageUrl: null,
              },
            ],
            removed: [{ productId: 'p-2', productName: 'Botol 600ml', quantity: 2 }],
            subtotal: 20_000,
          })
        : Promise.resolve([]),
    );

    render(<CartPage />, { wrapper: Wrap });

    expect(await screen.findByText('Galon 19L')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getAllByText(/Botol 600ml tidak lagi dijual/).length).toBeGreaterThan(0),
    );
  });

  it('says nothing on an ordinary cart', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('/cart')
        ? Promise.resolve({
            ...emptyCart,
            items: [
              {
                productId: 'p-1',
                productName: 'Galon 19L',
                sku: 'A',
                unit: 'galon',
                unitPrice: 20_000,
                quantity: 1,
                lineTotal: 20_000,
                isGallon: true,
                imageUrl: null,
              },
            ],
            subtotal: 20_000,
          })
        : Promise.resolve([]),
    );

    render(<CartPage />, { wrapper: Wrap });

    expect(await screen.findByText('Galon 19L')).toBeTruthy();
    expect(screen.queryByText(/tidak lagi dijual/)).toBeNull();
  });
});
