// @vitest-environment jsdom
/**
 * PG-03 — the shelf and the till quoting different numbers.
 *
 * The catalogue grid and the product page printed `product.basePrice`. The cart and the
 * checkout price every line against the depot that will fulfil the order. At a depot running
 * a +10% rule the shopper read Rp20.000 a galon on both shelves, pressed a button that said
 * Rp40.000 for two, and then saw Rp44.000 in the cart with nothing having changed but the
 * screen they were on.
 *
 * What is pinned here: the shelf asks the server for the depot's price and renders THAT, and
 * when the server says the answer is a catalogue price the screen says so instead of passing
 * it off as the depot's.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/products/detail',
}));
// The page reads `?id=` off window.location (see lib/use-query-param.ts — no
// useSearchParams, because a Suspense boundary would break the static export).
window.history.replaceState({}, '', '/products/detail?id=p1');
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached } };
});
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: null, ready: true }) }));
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: { lat: -6.2, lng: 106.8, depotId: 'depot-1' } }),
}));

import ProductDetailPage from '@/app/products/detail/page';
import { ToastProvider } from '@/components/toast';
import { CartProvider } from '@/lib/cart-context';
import { LocaleProvider } from '@/lib/locale-context';
import { endpoints } from '@/lib/endpoints';

const PRODUCT = {
  id: 'p1',
  name: 'Air Galon 19L',
  sku: 'AIR-19L',
  unit: 'Galon',
  basePrice: 20000,
  categoryId: 'c1',
  imageUrl: null,
  active: true,
  isGallon: true,
  volumeMl: 19000,
};

function route(path: string, shelf: unknown) {
  if (path.startsWith('/orders/api/v1/cart/shelf-prices')) return Promise.resolve(shelf);
  if (path.endsWith('/products/p1')) return Promise.resolve(PRODUCT);
  if (path.includes('/categories')) return Promise.resolve([{ id: 'c1', name: 'Galon' }]);
  if (path.includes('/depots/nearby')) return Promise.resolve([]);
  return Promise.resolve([]);
}

function show() {
  render(
    <LocaleProvider>
      <ToastProvider>
        <CartProvider>
          <ProductDetailPage />
        </CartProvider>
      </ToastProvider>
    </LocaleProvider>,
  );
}

afterEach(() => vi.clearAllMocks());
beforeEach(() => {
  get.mockReset();
  getCached.mockReset();
});

describe("PG-03 · the product page shows the depot's price", () => {
  it('renders the depot price, not the catalogue price', async () => {
    const shelf = { basis: 'DEPOT', prices: [{ productId: 'p1', unitPrice: 22000 }] };
    get.mockImplementation((p: string) => route(p, shelf));
    getCached.mockImplementation((p: string) => route(p, shelf));

    show();

    await waitFor(() => expect(screen.getAllByText(/22\.000/).length).toBeGreaterThan(0));
    // The catalogue price must not be on the screen at all — that was the number that
    // differed from the bill.
    expect(screen.queryByText(/20\.000/)).toBeNull();
    expect(getCached).toHaveBeenCalledWith(endpoints.cart.shelfPrices(['p1'], 'depot-1'));
  });

  it('labels the price as an estimate when the depot could not be asked', async () => {
    const shelf = { basis: 'CATALOG', prices: [{ productId: 'p1', unitPrice: 20000 }] };
    get.mockImplementation((p: string) => route(p, shelf));
    getCached.mockImplementation((p: string) => route(p, shelf));

    show();

    await waitFor(() => expect(screen.getAllByText(/20\.000/).length).toBeGreaterThan(0));
    expect(screen.getByText(/harga perkiraan|estimated prices/i)).toBeTruthy();
  });
});
