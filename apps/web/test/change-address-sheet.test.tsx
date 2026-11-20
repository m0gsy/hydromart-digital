// @vitest-environment jsdom
/**
 * Owner decision 2026-11-20: the customer moves an order to another saved address before it
 * is prepared. The sheet offers pinned addresses only, posts the whole snapshot, and shows
 * the server's refusal (another depot, too late) where the customer can read it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { get, post, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  FakeApiError: class FakeApiError extends Error {
    constructor(
      message: string,
      readonly status = 409,
      readonly code = 'ORDER_ADDRESS_NOT_CHANGEABLE',
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { get, getCached: get, post }, ApiError: FakeApiError }));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import { ChangeAddressSheet } from '@/components/order/change-address-sheet';
import type { Order } from '@/lib/types';

const ORDER = { id: 'o-1', depotId: 'd-1', status: 'CONFIRMED' } as unknown as Order;
const HOME = {
  id: 'a-1',
  label: 'Rumah',
  recipientName: 'Wahyu',
  phone: '0812',
  addressLine: 'Jl. Satu 1',
  city: 'Bandung',
  latitude: -6.9,
  longitude: 107.6,
  notes: 'pagar hijau',
};
const NO_PIN = { ...HOME, id: 'a-2', label: 'Lama', addressLine: 'Jl. Tanpa Pin', latitude: null, longitude: null };

const mount = (onDone = vi.fn()) =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <ChangeAddressSheet order={ORDER} onClose={vi.fn()} onDone={onDone} />
      </ToastProvider>
    </LocaleProvider>,
  );

afterEach(() => vi.clearAllMocks());

describe('ChangeAddressSheet', () => {
  it('offers only pinned addresses and posts the whole snapshot', async () => {
    get.mockResolvedValue([HOME, NO_PIN]);
    post.mockResolvedValue({});
    const onDone = vi.fn();
    mount(onDone);

    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Rumah · Jl. Satu 1']);
    fireEvent.click(screen.getByRole('button', { name: /pindahkan pesanan/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      '/orders/api/v1/orders/o-1/address',
      {
        deliveryAddress: {
          recipientName: 'Wahyu',
          phone: '0812',
          addressLine: 'Jl. Satu 1',
          city: 'Bandung',
          latitude: -6.9,
          longitude: 107.6,
          notes: 'pagar hijau',
        },
      },
      true,
    );
  });

  it('shows the server refusal and stays open', async () => {
    get.mockResolvedValue([HOME]);
    post.mockRejectedValue(new FakeApiError('Alamat baru ini dilayani depot lain.'));
    const onDone = vi.fn();
    mount(onDone);

    fireEvent.click(await screen.findByRole('button', { name: /pindahkan pesanan/i }));

    expect(await screen.findByText(/dilayani depot lain/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('points to the address book when there is nothing pinned to move to', async () => {
    get.mockResolvedValue([NO_PIN]);
    mount();
    expect(await screen.findByRole('link', { name: /kelola alamat/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /pindahkan pesanan/i })).toBeDisabled();
  });
});
