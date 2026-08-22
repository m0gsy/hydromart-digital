// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post },
  ApiError: class ApiError extends Error {},
}));
// Mutable so a case can put the screen in a different state without a second mock factory.
const state = { customer: { id: 'c-1' } as { id: string } | null, location: null as { lat: number; lng: number } | null, rate: 0 };

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: state.customer }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: state.location }) }));
vi.mock('@/lib/member', () => ({
  useMemberRate: () => state.rate,
  memberPrice: (n: number, r: number) => Math.round(n * (1 - r)),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'p-hero' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/products/detail',
  useSearchParams: () => new URLSearchParams('id=p-hero'),
}));

import { LocaleProvider } from '@/lib/locale-context';
import ProductDetailPage from '@/app/products/detail/page';

const HERO = { id: 'p-hero', name: 'Galon 19L', unit: 'Galon', basePrice: 20000, imageUrl: null };
const RELATED = [{ productId: 'p-rel', name: 'Tutup Galon', sku: 'TG', unit: 'Pcs', score: 2 }];

/**
 * H1. The frequently-bought-together card drew the placeholder drop UNCONDITIONALLY, so a
 * related product's photo could never appear on the detail screen however many were
 * uploaded. It is the same defect already fixed on the home rail — this card is a copy
 * taken before that fix — so the same shape answers it: one batch call for the four cards
 * about to be drawn, and a failure there costs the photos and nothing else.
 */
describe('product detail — frequently bought together photos', () => {
  beforeEach(() => {
    state.customer = { id: 'c-1' };
    state.location = null;
    state.rate = 0;
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/recommendations/')) return Promise.resolve(RELATED);
      if (p.includes('/products/p-hero')) return Promise.resolve(HERO);
      return Promise.resolve(null);
    });
    getCached.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/products/batch')) {
        return Promise.resolve([{ id: 'p-rel', name: 'Tutup Galon', imageUrl: 'https://cdn.test/tutup.jpg' }]);
      }
      if (p.includes('categories')) return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });
  afterEach(() => vi.clearAllMocks());

  const renderPage = () => render(<ProductDetailPage />, { wrapper: LocaleProvider });

  it('shows the catalogue photo of a related product', async () => {
    renderPage();

    const img = await screen.findByRole('img', { name: 'Tutup Galon' });
    expect(img.getAttribute('src')).toBe('https://cdn.test/tutup.jpg');
  });

  it('asks for every related photo in ONE call, not one per card', async () => {
    renderPage();

    await screen.findByRole('img', { name: 'Tutup Galon' });
    const batch = [...get.mock.calls, ...getCached.mock.calls]
      .map((c) => String(c[0]))
      .filter((p) => p.includes('/products/batch'));
    expect(batch).toHaveLength(1);
    expect(batch[0]).toContain('ids=p-rel');
  });

  it('still renders the related card when the photo lookup fails', async () => {
    getCached.mockImplementation((path: string) =>
      String(path).includes('/products/batch')
        ? Promise.reject(new Error('503'))
        : Promise.resolve([]),
    );

    renderPage();

    await screen.findByText('Tutup Galon');
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Tutup Galon' })).toBeNull(),
    );
  });
});


/**
 * The states this screen draws, and the ones it used to draw for nobody: before H1 landed
 * a test on this page it had no render coverage at all, so v8 reported it as a single
 * covered line and the gate read "fine". Every case below is a branch that was executing
 * in production and measured by nothing.
 */
describe('product detail — the states it draws', () => {
  const FULL = {
    id: 'p-hero',
    name: 'Galon 19L',
    unit: 'Galon',
    basePrice: 20000,
    imageUrl: 'https://cdn.test/hero.jpg',
    images: ['https://cdn.test/hero.jpg', 'https://cdn.test/side.jpg'],
    description: 'Air mineral pegunungan.',
    categoryId: 'cat-1',
  };

  beforeEach(() => {
    state.customer = { id: 'c-1' };
    state.location = null;
    state.rate = 0;
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/recommendations/')) return Promise.resolve([]);
      if (p.includes('/products/p-hero')) return Promise.resolve(FULL);
      if (p.includes('/loyalty/me')) return Promise.resolve({ discountRate: 0.05, tier: 'GOLD' });
      if (p.includes('/depots')) {
        return Promise.resolve([{ id: 'd-1', name: 'Depot Kemang', distanceKm: 1.2, deliveryFee: 5000 }]);
      }
      return Promise.resolve(null);
    });
    getCached.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('categories')) return Promise.resolve([{ id: 'cat-1', name: 'Galon' }]);
      return Promise.resolve([]);
    });
  });

  it('draws the hero photo, the gallery and the description when the product has them', async () => {
    render(<ProductDetailPage />, { wrapper: LocaleProvider });

    const hero = await screen.findByRole('img', { name: /Galon 19L/ });
    expect(hero.getAttribute('src')).toBe('https://cdn.test/hero.jpg');
    expect(await screen.findByText('Air mineral pegunungan.')).toBeInTheDocument();
    // The category breadcrumb only appears once the categories call resolves a match.
    expect(await screen.findAllByText('Galon')).not.toHaveLength(0);
  });

  it('shows the member price only when a member rate applies', async () => {
    state.rate = 0.1;
    render(<ProductDetailPage />, { wrapper: LocaleProvider });
    expect(await screen.findByText(/18\.000/)).toBeInTheDocument();
  });

  it('names the serving depot once a location is known', async () => {
    state.location = { lat: -6.2, lng: 106.8 };
    render(<ProductDetailPage />, { wrapper: LocaleProvider });
    expect(await screen.findByText(/Depot Kemang/)).toBeInTheDocument();
  });

  it('offers a retry rather than a blank screen when the product will not load', async () => {
    get.mockImplementation((path: string) =>
      String(path).includes('/products/p-hero')
        ? Promise.reject(new Error('503 dari katalog'))
        : Promise.resolve([]),
    );
    render(<ProductDetailPage />, { wrapper: LocaleProvider });
    expect(await screen.findByRole('button', { name: /coba lagi|try again/i })).toBeInTheDocument();
  });
});
