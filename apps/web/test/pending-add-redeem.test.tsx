// @vitest-environment jsdom
/**
 * G1 — the redemption half. `CartProvider` is where a stashed add is spent, and it is the
 * only place it could be: it is mounted on every shopping route and already watches the
 * session change, so it also covers a biometric unlock that restores a session without the
 * login screen rendering at all.
 *
 * The assertions are on CALL SHAPE, in the spirit of `cart-round-trips.test.tsx`:
 * redeeming must cost no extra round trip, because `POST /cart/items` already answers with
 * the whole priced cart.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, session } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  session: { customer: { id: 'c1' } as { id: string } | null, ready: true },
}));

vi.mock('@/lib/api', () => ({ api: { get, getCached: get, post, put: vi.fn(), del: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => session }));

import { CartProvider, useCart } from '@/lib/cart-context';
import { setPendingAdd } from '@/lib/pending-add';

const EMPTY = { items: [], subtotal: 0 };
const WITH_ITEM = {
  items: [{ productId: 'p1', productName: 'Galon 19L', unit: 'galon', quantity: 3, unitPrice: 20_000, lineTotal: 60_000 }],
  subtotal: 60_000,
};

function Badge() {
  const { count, ready } = useCart();
  return <span>{ready ? `count:${count}` : 'loading'}</span>;
}

const show = () => render(<CartProvider><Badge /></CartProvider>);

beforeEach(() => {
  sessionStorage.clear();
  session.customer = { id: 'c1' };
  get.mockReset().mockResolvedValue(EMPTY);
  post.mockReset().mockResolvedValue(WITH_ITEM);
});
afterEach(() => vi.clearAllMocks());

describe('redeeming a pending add', () => {
  it('spends the stashed item on sign-in and adopts the cart it answers with', async () => {
    setPendingAdd({ productId: 'p1', quantity: 3 });
    show();
    await waitFor(() => expect(screen.getByText('count:3')).toBeTruthy());
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[1]).toEqual({ productId: 'p1', quantity: 3 });
    // No follow-up read: the POST already returned the priced cart.
    expect(get).not.toHaveBeenCalled();
  });

  it('reads the cart normally when nothing was stashed', async () => {
    show();
    await waitFor(() => expect(screen.getByText('count:0')).toBeTruthy());
    expect(post).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
  });

  // The shopper is signed in with an unchanged cart — where they already were. Staring at
  // an error for a tap made two screens ago would be worse than the silence.
  it('falls back to the ordinary read when redeeming fails', async () => {
    setPendingAdd({ productId: 'p1', quantity: 1 });
    post.mockRejectedValue(new Error('gone'));
    show();
    await waitFor(() => expect(screen.getByText('count:0')).toBeTruthy());
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('spends nothing while nobody is signed in', async () => {
    setPendingAdd({ productId: 'p1', quantity: 1 });
    session.customer = null;
    show();
    await waitFor(() => expect(screen.getByText('count:0')).toBeTruthy());
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
