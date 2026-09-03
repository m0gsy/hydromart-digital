// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { push, get, post, del } = vi.hoisted(() => ({
  push: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));
let customer: { id: string } | null = null;

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer }) }));
// The seed read is `getCached` (audit F-2) — one favourites list per grid, not one per card.
vi.mock('@/lib/api', () => ({ api: { get, getCached: get, post, del } }));

import { LocaleProvider } from '@/lib/locale-context';
import { FavoriteButton } from '@/components/favorite-button';

beforeEach(() => {
  push.mockReset();
  get.mockReset().mockResolvedValue({ productIds: [] });
  post.mockReset().mockResolvedValue(undefined);
  del.mockReset().mockResolvedValue(undefined);
  customer = null;
});
afterEach(() => vi.clearAllMocks());

describe('FavoriteButton', () => {
  /*
   * G1. This used to assert `next=/products/detail?id=p1` — the gate sent every guest to a
   * PRODUCT PAGE after signing in, whatever screen they had been on. This button lives on
   * catalog cards and rails as much as on the detail screen, so "come back" meant "go
   * somewhere else" for most of the people who pressed it. It returns to where they are now.
   */
  it('a guest is sent to login and back to the screen they were on', async () => {
    customer = null;
    window.history.pushState({}, '', '/products?category=galon');
    render(<FavoriteButton productId="p1" />, { wrapper: LocaleProvider });
    await userEvent.click(screen.getByRole('button'));
    expect(push).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent('/products?category=galon')}`,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('seeds pressed state from the favorites list on mount', async () => {
    customer = { id: 'c1' };
    get.mockResolvedValue({ productIds: ['p1'] });
    render(<FavoriteButton productId="p1" />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('optimistically toggles on and POSTs add', async () => {
    customer = { id: 'c1' };
    render(<FavoriteButton productId="p1" />, { wrapper: LocaleProvider });
    const btn = screen.getByRole('button');
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'false'));
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('reverts optimistic state when the write fails', async () => {
    customer = { id: 'c1' };
    post.mockRejectedValue(new Error('boom'));
    render(<FavoriteButton productId="p1" />, { wrapper: LocaleProvider });
    const btn = screen.getByRole('button');
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'false'));
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'false'));
  });
});
