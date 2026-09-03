// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1' }, ready: true }),
}));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/lib/member', () => ({ useMemberRate: () => 0 }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// The shopper HAS chosen a delivery location, so a depot is known — the state in which a
// catalogue price on screen is a price the till will not honour.
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: { depotId: 'd-1', label: 'Rumah' } }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/favorites',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import FavoritesPage from '@/app/favorites/page';
import PromoPage from '@/app/promo/page';

const PRODUCT = { id: 'p-1', name: 'Galon 19L', unit: 'Galon', basePrice: 20000, imageUrl: null };
/** The depot runs a +10% rule — the split CA-3-08/CA-3-11 are about. */
const DEPOT_PRICE = 22000;

const shelf = (basis: 'DEPOT' | 'CATALOG') =>
  basis === 'DEPOT'
    ? { basis, prices: [{ productId: 'p-1', unitPrice: DEPOT_PRICE }] }
    : { basis, prices: [] };

/**
 * CA-3-08 / CA-3-11. PG-03 taught the catalogue grid and the product page to print the
 * price the shopper's own depot charges. Favourites and Promo were never taught, so both
 * kept printing `product.basePrice` while the cart billed the depot's — and the Promo
 * screen did it under a badge that says the price is the reason to be there.
 *
 * Two claims per screen, because either alone is a half-fix: show the depot's number when
 * it can be had, and SAY the number is a catalogue estimate when it cannot.
 */
describe('shelf prices reach favourites and promo (CA-3-08, CA-3-11)', () => {
  beforeEach(() => {
    get.mockReset();
    getCached.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  const wireFavorites = (basis: 'DEPOT' | 'CATALOG') => {
    getCached.mockImplementation((url: string) =>
      url.includes('shelf-prices')
        ? Promise.resolve(shelf(basis))
        : Promise.resolve({ productIds: ['p-1'] }),
    );
    get.mockResolvedValue(PRODUCT);
  };

  it('favourites prints the depot price, not the catalogue price', async () => {
    wireFavorites('DEPOT');
    render(<FavoritesPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/22\.000/)).toBeTruthy();
    expect(screen.queryByText(/20\.000/)).toBeNull();
  });

  it('favourites says so when all it has is the catalogue price', async () => {
    wireFavorites('CATALOG');
    render(<FavoritesPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/20\.000/)).toBeTruthy();
    // The notice is the whole point: the number above is not what checkout will bill.
    await waitFor(() => expect(screen.getByText(/harga perkiraan/i)).toBeTruthy());
  });

  const wirePromo = (basis: 'DEPOT' | 'CATALOG') => {
    getCached.mockImplementation((url: string) =>
      url.includes('shelf-prices') ? Promise.resolve(shelf(basis)) : Promise.resolve({ items: [] }),
    );
    // The promo feed answers with an ARRAY; the product strip with a page. Mixing the two
    // shapes up makes the screen crash rather than fail this test's actual claim.
    get.mockImplementation((url: string) =>
      url.includes('/products')
        ? Promise.resolve({ items: [PRODUCT], total: 1, page: 1, limit: 20 })
        : Promise.resolve([]),
    );
  };

  it('promo prints the depot price under its badge', async () => {
    wirePromo('DEPOT');
    render(<PromoPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/22\.000/)).toBeTruthy();
    expect(screen.queryByText(/20\.000/)).toBeNull();
  });

  it('promo says so when all it has is the catalogue price', async () => {
    wirePromo('CATALOG');
    render(<PromoPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/20\.000/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/harga perkiraan/i)).toBeTruthy());
  });
});
