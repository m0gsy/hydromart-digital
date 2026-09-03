// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The catalog accumulates pages now — numbered pagination was 38px targets in a row on a
 * phone, and paging away and back lost the scroll position every time. Accumulating is the
 * part that can go quietly wrong: a page written into the grid twice, or the previous
 * category's products still on screen after tapping a new one.
 */

const { get, params, push } = vi.hoisted(() => ({
  get: vi.fn(),
  params: { current: new URLSearchParams() },
  push: vi.fn(),
}));

// CA-3-24: `ProductCard` reports a failed add through the toast, and `useToast` refuses to
// work outside its provider — as it should.
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => params.current,
}));
vi.mock('@/lib/api', () => ({
  api: { get, getCached: get },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('@/lib/member', () => ({ useMemberRate: () => 0 }));
vi.mock('@/components/product-card', () => ({
  ProductCard: ({ product }: { product: { name: string } }) => <div>{product.name}</div>,
}));

import ProductsPage from '@/app/products/page';

const product = (name: string) => ({
  id: name,
  name,
  unit: 'galon',
  price: 20_000,
  imageUrl: null,
  categoryId: 'c1',
});

/** Three products, one per page, so "load more" is reachable twice. */
function scriptCatalog(total = 3, prefix = 'Galon') {
  get.mockImplementation((path: string) => {
    if (path.includes('/categories')) return Promise.resolve([]);
    if (path.includes('/products/api/v1/products')) {
      const page = Number(new URL(path, 'http://x').searchParams.get('page') ?? 1);
      return Promise.resolve({ items: [product(`${prefix} ${page}`)], total, page, limit: 1 });
    }
    return Promise.reject(new Error(`not scripted: ${path}`));
  });
}

beforeEach(() => {
  params.current = new URLSearchParams();
  get.mockReset();
  push.mockReset();
  scriptCatalog();
});
afterEach(() => vi.clearAllMocks());

describe('catalog paging', () => {
  it('appends the next page instead of replacing the grid', async () => {
    render(<ProductsPage />);
    await waitFor(() => expect(screen.getByText('Galon 1')).toBeTruthy());

    await userEvent.click(screen.getByText('shop.catalog.loadMore'));

    await waitFor(() => expect(screen.getByText('Galon 2')).toBeTruthy());
    // Still there — this is the whole point of accumulating.
    expect(screen.getByText('Galon 1')).toBeTruthy();
    // And exactly once: keyed by page number, so a re-run cannot double it in.
    expect(screen.getAllByText('Galon 1')).toHaveLength(1);
  });

  it('stops offering more once the last page has landed', async () => {
    scriptCatalog(2);
    render(<ProductsPage />);
    await waitFor(() => expect(screen.getByText('Galon 1')).toBeTruthy());

    await userEvent.click(screen.getByText('shop.catalog.loadMore'));

    await waitFor(() => expect(screen.getByText('Galon 2')).toBeTruthy());
    expect(screen.queryByText('shop.catalog.loadMore')).toBeNull();
  });

  it('drops the previous filter’s products the moment the filter changes', async () => {
    const { rerender } = render(<ProductsPage />);
    await waitFor(() => expect(screen.getByText('Galon 1')).toBeTruthy());

    // What a category pill does: the URL changes, the same page re-renders.
    scriptCatalog(3, 'Botol');
    params.current = new URLSearchParams('category=c2');
    rerender(<ProductsPage />);

    // Not one frame of the old category, and never both at once.
    expect(screen.queryByText('Galon 1')).toBeNull();
    await waitFor(() => expect(screen.getByText('Botol 1')).toBeTruthy());
    expect(screen.queryByText('Galon 1')).toBeNull();
  });

  it('asks for page 1 of the new filter, not the page you were on', async () => {
    const { rerender } = render(<ProductsPage />);
    await waitFor(() => expect(screen.getByText('Galon 1')).toBeTruthy());
    await userEvent.click(screen.getByText('shop.catalog.loadMore'));
    await waitFor(() => expect(screen.getByText('Galon 2')).toBeTruthy());

    params.current = new URLSearchParams('category=c2');
    rerender(<ProductsPage />);

    await waitFor(() => expect(pagesAskedFor('c2')).toEqual([1]));
  });
});

/** Which `page=` values were requested for a given category filter. */
function pagesAskedFor(categoryId: string): number[] {
  return get.mock.calls
    .map(([path]) => path as string)
    .filter(
      (path) =>
        path.includes('/products/api/v1/products') && path.includes(`categoryId=${categoryId}`),
    )
    .map((path) => Number(new URL(path, 'http://x').searchParams.get('page') ?? 1));
}
