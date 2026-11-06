// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, patch, post } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, patch, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'kd-1', role: 'KEPALA_DEPOT' } }),
}));

import { OrderDetail } from '@/components/dashboard/order-detail';
import { ConfirmProvider } from '@/components/confirm';
import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const ORDER = {
  id: 'ord-1',
  orderNumber: 'HM-0001',
  status: 'PENDING_PAYMENT',
  depotId: 'depot-a',
  recipientName: 'Ani',
  phone: '0899',
  deliveryAddress: 'Jl. Satu',
  items: [],
  history: [],
  subtotal: 0,
  deliveryFee: 0,
  discount: 0,
  total: 0,
  createdAt: '2026-08-04T02:00:00.000Z',
} as never;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('/payments')
        ? { items: [{ id: 'pay-1', status: 'PENDING', method: 'TRANSFER' }] }
        : { items: [] },
    ),
  );
  post.mockResolvedValue({});
});

const renderDetail = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <ConfirmProvider>
          <OrderDetail order={ORDER} onClose={() => {}} onChanged={() => {}} />
        </ConfirmProvider>
      </ToastProvider>
    </LocaleProvider>,
  );

// A4-03: "Konfirmasi lunas" moves money state and posted on the first click, while the
// button beside it ("Tandai gagal") already asked first.
describe('OrderDetail confirm-paid', () => {
  it('asks before marking paid, and posts nothing until the dialog is accepted', async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Konfirmasi lunas' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => /lunas/i.test(b.textContent ?? ''))!,
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('posts nothing when the dialog is cancelled', async () => {
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: 'Konfirmasi lunas' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => /batal|cancel/i.test(b.textContent ?? ''))!,
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(post).not.toHaveBeenCalled();
  });
});
