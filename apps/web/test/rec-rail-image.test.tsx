// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
}));

// `ProductCard` and the recommendation rail now report a failed add through the toast
// (CA-3-24), and `useToast` refuses to work outside its provider — as it should.
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  api: { get, getCached, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'c-1' } }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ProductRecRail } from '@/components/product-rec-rail';

const REC = [{ productId: 'p-1', name: 'Galon 19L', sku: 'G19', unit: 'Galon', score: 3 }];

beforeEach(() => {
  get.mockReset();
  getCached.mockReset();
});
afterEach(() => vi.clearAllMocks());

/*
 * The home page draws every product rail through this component, and it rendered the
 * placeholder drop UNCONDITIONALLY — so an uploaded product photo could never appear
 * there, however many were uploaded. It showed on the detail screen and in the /products
 * grid, which both read `imageUrl`, and nowhere else.
 *
 * A recommendation carries no image (recommendation-service mirrors name/sku/unit only),
 * so the rail has to ask the catalogue for the photos of the cards it is about to draw.
 */
describe('home product rail', () => {
  const renderRail = () =>
    render(
      <LocaleProvider>
        <ProductRecRail title="Sering dibeli" endpoint="/recommendations/api/v1/x" />
      </LocaleProvider>,
    );

  it('shows the product photo the catalogue has for it', async () => {
    getCached.mockImplementation((path: string) =>
      String(path).includes('/products/batch')
        ? Promise.resolve([
            { id: 'p-1', name: 'Galon 19L', imageUrl: 'https://cdn.test/galon.jpg' },
          ])
        : Promise.resolve(REC),
    );

    renderRail();

    const img = await screen.findByRole('img', { name: 'Galon 19L' });
    expect(img.getAttribute('src')).toBe('https://cdn.test/galon.jpg');
    // One call for the whole rail, not one per card.
    const batchPaths = getCached.mock.calls
      .map((c) => String(c[0]))
      .filter((path) => path.includes('/products/batch'));
    expect(batchPaths).toHaveLength(1);
    expect(batchPaths.join('')).toContain('ids=p-1');
  });

  // The photos are a nicety; the rail is the feature. A catalogue that will not answer
  // must cost the picture and nothing else.
  it('still renders the rail when the photo lookup fails', async () => {
    getCached.mockImplementation((path: string) =>
      String(path).includes('/products/batch')
        ? Promise.reject(new Error('503'))
        : Promise.resolve(REC),
    );

    renderRail();

    await screen.findByText('Galon 19L');
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
  });

  /*
   * recommendation-service mirrors a product's NAME off the order item that last bought it,
   * and an order item is a snapshot of the catalogue on the day of that sale. Rename a
   * product and the rails kept the old name until somebody bought it again — so 'Beli lagi'
   * and 'Sering dibeli bersama' disagreed with the product page they link to.
   *
   * The catalogue read was already happening for the photo. The name comes from the same
   * answer now, so it cannot drift.
   */
  it('prefers the catalogue name over the one the recommendation carries', async () => {
    getCached.mockImplementation((path: string) =>
      String(path).includes('/products/batch')
        ? Promise.resolve([
            { id: 'p-1', name: 'Galon Baru + Air 19L', imageUrl: 'https://cdn.test/g.jpg' },
          ])
        : Promise.resolve(REC),
    );
    renderRail();
    await screen.findByText('Galon Baru + Air 19L');
    expect(screen.queryByText('Galon 19L')).toBeNull();
  });

  // Until the catalogue answers there is nothing better to show, and a blank card is worse
  // than a stale name.
  it('falls back to the recommendation name when the catalogue does not answer', async () => {
    getCached.mockImplementation((path: string) =>
      String(path).includes('/products/batch')
        ? Promise.reject(new Error('503'))
        : Promise.resolve(REC),
    );
    renderRail();
    await screen.findByText('Galon 19L');
  });

  it('falls back to the placeholder for a product with no photo', async () => {
    getCached.mockImplementation((path: string) =>
      String(path).includes('/products/batch')
        ? Promise.resolve([{ id: 'p-1', name: 'Galon 19L', imageUrl: null }])
        : Promise.resolve(REC),
    );

    renderRail();

    await screen.findByText('Galon 19L');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
