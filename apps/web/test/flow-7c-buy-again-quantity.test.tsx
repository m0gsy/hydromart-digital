// @vitest-environment jsdom
/**
 * Flow plan PR-7c · "Beli lagi" puts back the quantity last bought.
 *
 * The rail always added one galon. recommendation-service now sends `lastQuantity` on the
 * customer's own reorder items: the units on their latest order of it. Trending items and
 * rows written before the column carry none, and those still add one.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCached, post } = vi.hoisted(() => ({ getCached: vi.fn(), post: vi.fn() }));

vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  api: { get: getCached, getCached, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'c-1' } }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ProductRecRail } from '@/components/product-rec-rail';

const serve = (recs: unknown[]) =>
  getCached.mockImplementation((path: string) =>
    Promise.resolve(String(path).includes('/products/batch') ? [] : recs),
  );

const draw = () =>
  render(
    <LocaleProvider>
      <ProductRecRail title="Beli lagi" endpoint="/recommendations/api/v1/recommendations/reorder" requiresAuth />
    </LocaleProvider>,
  );

beforeEach(() => {
  getCached.mockReset();
  post.mockReset().mockResolvedValue({ items: [] });
});
afterEach(() => vi.clearAllMocks());

describe('"Beli lagi" adds what was bought last time', () => {
  it('four galons last order: four go in, and the card says so before the tap', async () => {
    serve([{ productId: 'p-1', name: 'Galon 19L', sku: 'G19', unit: 'Galon', score: 3, lastQuantity: 4 }]);
    draw();
    const add = await screen.findByRole('button', { name: /4/ });
    expect(screen.getByText(/×\s?4/)).toBeTruthy();
    fireEvent.click(add);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toEqual({ productId: 'p-1', quantity: 4 });
  });

  it('no quantity known (trending, an older row): one, as before', async () => {
    serve([{ productId: 'p-2', name: 'Galon 12L', sku: 'G12', unit: 'Galon', score: 2 }]);
    draw();
    fireEvent.click(await screen.findByRole('button', { name: /Galon 12L/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toEqual({ productId: 'p-2', quantity: 1 });
    expect(screen.queryByText(/×/)).toBeNull();
  });
});

describe('review round', () => {
  it("a bulk last order is held to the cart's 999 a line", async () => {
    serve([{ productId: 'p-1', name: 'Galon 19L', sku: 'G19', unit: 'Galon', score: 3, lastQuantity: 1200 }]);
    draw();
    fireEvent.click(await screen.findByRole('button', { name: /999/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toEqual({ productId: 'p-1', quantity: 999 });
  });

  it('once added, the card is done: a second tap does not put the order in again', async () => {
    serve([{ productId: 'p-1', name: 'Galon 19L', sku: 'G19', unit: 'Galon', score: 3, lastQuantity: 4 }]);
    draw();
    const add = (await screen.findByRole('button', { name: /4/ })) as HTMLButtonElement;
    fireEvent.click(add);
    await waitFor(() => expect(add.disabled).toBe(true));
    fireEvent.click(add);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
