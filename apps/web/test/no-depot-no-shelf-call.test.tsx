// @vitest-environment jsdom
/**
 * PG-03, the other half: a shopper who has not chosen a delivery location has no depot, so
 * there is nothing to ask and nothing to label. The catalogue price is simply what they get.
 *
 * Asking anyway cost every catalogue page a network request to be told what it already had —
 * the Lighthouse ratchet caught it on the first CI run of that change (/products made 49
 * requests against a 48 ceiling). This pins the fix: no location, no call.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/products/detail',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached } };
});
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: null, ready: true }) }));
// No location chosen — the state every first-time visitor is in.
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));

import ProductDetailPage from '@/app/products/detail/page';
import { ToastProvider } from '@/components/toast';
import { CartProvider } from '@/lib/cart-context';
import { LocaleProvider } from '@/lib/locale-context';

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

function route(path: string) {
  if (path.endsWith('/products/p1')) return Promise.resolve(PRODUCT);
  if (path.includes('/categories')) return Promise.resolve([{ id: 'c1', name: 'Galon' }]);
  return Promise.resolve([]);
}

beforeEach(() => {
  window.history.replaceState({}, '', '/products/detail?id=p1');
  get.mockReset().mockImplementation(route);
  getCached.mockReset().mockImplementation(route);
});
afterEach(() => vi.clearAllMocks());

describe('PG-03 · no depot, no shelf-price call', () => {
  it('renders the catalogue price and asks nobody for a depot price', async () => {
    render(
      <LocaleProvider>
        <ToastProvider>
          <CartProvider>
            <ProductDetailPage />
          </CartProvider>
        </ToastProvider>
      </LocaleProvider>,
    );

    await waitFor(() => expect(screen.getAllByText(/20\.000/).length).toBeGreaterThan(0));

    const asked = [...get.mock.calls, ...getCached.mock.calls].map((c) => String(c[0]));
    expect(asked.some((p) => p.includes('shelf-prices'))).toBe(false);
    // ...and no "estimated prices" note, because nothing was estimated: the shopper has not
    // said where they are, so there is no depot price this could be differing from.
    expect(screen.queryByText(/harga perkiraan|estimated prices/i)).toBeNull();
  });
});
