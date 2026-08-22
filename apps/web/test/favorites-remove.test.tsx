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

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'c-1' }, ready: true }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
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
