// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-3-34 — the cart undid your tap and said nothing.
 *
 * All three cart writes were wrapped in a bare `catch {}` that rolled the optimistic state
 * back and stopped there. On screen that is a quantity snapping to its old number, or a row
 * you deleted reappearing, with no word said — which reads as the app overriding a
 * deliberate choice rather than as a request that failed.
 *
 * The rollback itself was always right. What was missing is the sentence, and the reason
 * the server usually already had one to give ("stok tinggal 2"): `ApiError.message` beats
 * the generic line, exactly as `product-card.tsx` does it.
 */

const { get, post, put, del, toast, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  toast: vi.fn(),
  // Hoisted with the spies: the mock factory below is lifted above the file, so a top-level
  // class declared here would not exist yet when it runs.
  FakeApiError: class FakeApiError extends Error {},
}));

const CART = {
  items: [
    {
      productId: 'p1',
      productName: 'Galon 19L',
      unit: 'galon',
      quantity: 2,
      unitPrice: 20_000,
      lineTotal: 40_000,
    },
  ],
  subtotal: 40_000,
};

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, put, del },
  ApiError: FakeApiError,
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c1' }, ready: true }),
}));

import CartPage from '@/app/cart/page';
import { CartProvider } from '@/lib/cart-context';
import { ConfirmProvider } from '@/components/confirm';

beforeEach(() => {
  get.mockReset().mockImplementation((path: string) =>
    path === '/orders/api/v1/cart' ? Promise.resolve(CART) : Promise.reject(new Error('unscripted')),
  );
  post.mockReset();
  put.mockReset();
  del.mockReset();
  toast.mockReset();
});
afterEach(() => vi.clearAllMocks());

async function renderCart() {
  render(
    <ConfirmProvider>
      <CartProvider>
        <CartPage />
      </CartProvider>
    </ConfirmProvider>,
  );
  await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());
}

const spoken = () => toast.mock.calls.map((c) => String(c[0]));

describe('CA-3-34 a cart write that fails says so', () => {
  it('says why a quantity change did not stick', async () => {
    put.mockRejectedValue(new FakeApiError('Stok tinggal 2'));
    await renderCart();

    await userEvent.click(screen.getByLabelText('Increase quantity'));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    // The server's own reason, not the generic line — it is the useful half.
    expect(spoken()).toContain('Stok tinggal 2');
    expect(toast.mock.calls[0][1]).toBe('error');
    // And the rollback that was already correct still happens.
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
  });

  it('falls back to a named message when the failure carries no reason', async () => {
    put.mockRejectedValue(new Error('socket hang up'));
    await renderCart();

    await userEvent.click(screen.getByLabelText('Increase quantity'));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    // A transport error's message is not a sentence for a customer.
    expect(spoken()).toContain('order.toast.updateFailed');
    expect(spoken()).not.toContain('socket hang up');
  });

  it('says why a deleted row came back', async () => {
    del.mockRejectedValue(new Error('boom'));
    await renderCart();

    await userEvent.click(screen.getByLabelText('order.cart.removeAria'));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    // Its own key: "could not remove that item" is not "could not update your cart".
    expect(spoken()).toContain('order.toast.removeFailed');
    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());
  });
});
