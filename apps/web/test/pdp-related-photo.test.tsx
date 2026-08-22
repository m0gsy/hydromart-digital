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
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'c-1' } }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('@/lib/member', () => ({ useMemberRate: () => 0, memberPrice: (n: number) => n }));
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
