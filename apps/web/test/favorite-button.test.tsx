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
vi.mock('@/lib/api', () => ({ api: { get, post, del } }));

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
  it('a guest is redirected to login instead of toggling', async () => {
    customer = null;
    render(<FavoriteButton productId="p1" />);
    await userEvent.click(screen.getByRole('button'));
    expect(push).toHaveBeenCalledWith('/login?next=%2Fproducts%2Fp1');
    expect(post).not.toHaveBeenCalled();
  });

  it('seeds pressed state from the favorites list on mount', async () => {
    customer = { id: 'c1' };
    get.mockResolvedValue({ productIds: ['p1'] });
    render(<FavoriteButton productId="p1" />);
    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('optimistically toggles on and POSTs add', async () => {
    customer = { id: 'c1' };
    render(<FavoriteButton productId="p1" />);
    const btn = screen.getByRole('button');
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'false'));
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('reverts optimistic state when the write fails', async () => {
    customer = { id: 'c1' };
    post.mockRejectedValue(new Error('boom'));
    render(<FavoriteButton productId="p1" />);
    const btn = screen.getByRole('button');
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'false'));
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'false'));
  });
});
