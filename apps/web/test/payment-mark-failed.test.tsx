// @vitest-environment jsdom
/*
 * CA-2-45 — a PENDING payment could only ever be confirmed.
 *
 * `POST :id/fail` and the `paymentSettle` capability behind it shipped with settlement and
 * no screen ever called them. So the only thing staff could say about a pending payment was
 * that it had landed. A transfer that never came, a QRIS scan that was abandoned, a
 * customer who changed their mind at the door — each sat PENDING for ever, holding the
 * order's stock and standing in the settlement queue as work still to do.
 *
 * FAILED is not the end of the road: `needsPayment` treats it as "no active payment", so
 * the customer can pay again. That is why this asks for a plain confirmation rather than a
 * reason, unlike the refund beside it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, role } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  role: { current: 'MANAGER' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/orders',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ConfirmProvider } from '@/components/confirm';
import { PaymentSettle } from '@/components/dashboard/order-detail';

const ORDER = { id: 'o-1', orderNumber: 'HM-0001', status: 'CONFIRMED' } as never;

const payment = (status: string) => ({
  items: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      orderId: 'o-1',
      method: 'TRANSFER',
      status,
      amount: 40_000,
      proofUrl: null,
      createdAt: '2026-08-10T03:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
});

const draw = () =>
  render(
    <LocaleProvider>
      <ConfirmProvider>
        <PaymentSettle order={ORDER} />
      </ConfirmProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  role.current = 'MANAGER';
  post.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('staff can say a pending payment never arrived (CA-2-45)', () => {
  it('offers the action, asks first, and calls the fail route', async () => {
    get.mockReset().mockResolvedValue(payment('PENDING'));
    draw();

    const button = await screen.findByRole('button', { name: /tandai gagal/i });
    await userEvent.click(button);

    // A deliberate second tap. The dialog's own button carries the same words as the one
    // that opened it, so take the last — the dialog renders after the row.
    const buttons = await screen.findAllByRole('button', { name: /^Tandai gagal$/ });
    await userEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toMatch(/\/payments\/.+\/fail$/);
  });

  it('offers nothing to mark on a payment that already settled', async () => {
    get.mockReset().mockResolvedValue(payment('PAID'));
    draw();

    // The refund path is the one for settled money; failing it makes no sense.
    await waitFor(() => expect(screen.queryByRole('button', { name: /tandai gagal/i })).toBeNull());
  });

  it('offers nothing to a role without paymentSettle', async () => {
    role.current = 'KURIR';
    get.mockReset().mockResolvedValue(payment('PENDING'));
    draw();

    await waitFor(() => expect(screen.queryByRole('button', { name: /tandai gagal/i })).toBeNull());
  });
});
