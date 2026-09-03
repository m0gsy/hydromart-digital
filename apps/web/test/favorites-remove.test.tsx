// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, del } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

// `ProductCard` and the recommendation rail now report a failed add through the toast
// (CA-3-24), and `useToast` refuses to work outside its provider — as it should.
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1' }, ready: true }),
}));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// CA-3-08: the grid now asks the shopper's depot for its prices. No location here, so the
// hook short-circuits and the tiles stay on catalogue prices — which is what this file tests.
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/favorites',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import FavoritesPage from '@/app/favorites/page';

const PRODUCT = { id: 'p-1', name: 'Galon 19L', unit: 'Galon', basePrice: 20000, imageUrl: null };

/**
 * H8. A favourite could be added from anywhere and removed from nowhere: the screen that
 * exists to hold them rendered plain catalogue tiles with no heart, so the only way to
 * drop one was to open its detail page. `FavoriteButton` already does the whole toggle —
 * the list simply never offered it.
 */
describe('/favorites — removing a favourite', () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue(PRODUCT);
    getCached.mockReset().mockResolvedValue({ productIds: ['p-1'] });
    post.mockReset().mockResolvedValue(undefined);
    del.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it('offers a remove control on every row', async () => {
    render(<FavoritesPage />, { wrapper: LocaleProvider });

    await screen.findByText('Galon 19L');
    const heart = await screen.findByRole('button', { name: /hapus dari favorit/i });
    expect(heart).toHaveAttribute('aria-pressed', 'true');
  });

  it('removing sends DELETE for that product', async () => {
    render(<FavoritesPage />, { wrapper: LocaleProvider });

    const heart = await screen.findByRole('button', { name: /hapus dari favorit/i });
    await userEvent.click(heart);

    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(String(del.mock.calls[0]?.[0])).toContain('/favorites/p-1');
  });
});

/**
 * The other two states this screen has. The "empty" one is the whole point of the screen
 * existing when nothing is saved, and the third is a favourite whose product was deleted
 * from the catalogue — a stale id must cost that one tile, never the whole grid.
 */
describe('/favorites — nothing saved, and a favourite that no longer exists', () => {
  it('offers a way to the catalogue when nothing is saved', async () => {
    getCached.mockResolvedValue({ productIds: [] });
    render(<FavoritesPage />, { wrapper: LocaleProvider });

    const link = await screen.findByRole('link', { name: /jelajahi produk/i });
    expect(link).toHaveAttribute('href', '/products');
    expect(get).not.toHaveBeenCalled();
  });

  it('drops only the tile whose product has gone, not the grid', async () => {
    getCached.mockResolvedValue({ productIds: ['p-1', 'p-gone'] });
    get.mockImplementation((path: string) =>
      String(path).includes('p-gone') ? Promise.reject(new Error('404')) : Promise.resolve(PRODUCT),
    );
    render(<FavoritesPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText('Galon 19L')).toBeInTheDocument();
    expect(screen.queryByText('p-gone')).toBeNull();
  });

  it('offers a retry when the favourites list itself will not load', async () => {
    getCached.mockRejectedValue(new Error('boom'));
    render(<FavoritesPage />, { wrapper: LocaleProvider });

    expect(await screen.findByRole('button', { name: /coba lagi|try again/i })).toBeInTheDocument();
  });
});
