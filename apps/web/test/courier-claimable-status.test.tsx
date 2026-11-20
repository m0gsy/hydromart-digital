// @vitest-environment jsdom
/**
 * Courier self-claim (fixed 2026-11-20, still OFF unless a depot turns it on).
 *
 * The list asked for CONFIRMED orders, but the only state a courier can be handed is
 * PREPARING (PREPARING → DRIVER_ASSIGNED), so every claim from this list was refused.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post } };
});

import { LocaleProvider } from '@/lib/locale-context';
import { ClaimableOrders } from '@/components/driver/claimable-orders';
import { ApiError } from '@/lib/api';

afterEach(() => vi.clearAllMocks());

describe('the claimable list', () => {
  it('lists the PREPARING orders of the courier depot', async () => {
    get.mockImplementation(async (path: string) =>
      String(path).includes('/settings')
        ? { courierSelfClaimEnabled: 1, courierSelfClaimWaitMinutes: 10 }
        : { items: [], total: 0, page: 1, limit: 20 },
    );
    render(<ClaimableOrders depotId="d-1" onClaimed={vi.fn()} />, { wrapper: LocaleProvider });

    await waitFor(() =>
      expect(get.mock.calls.some(([p]) => String(p).includes('/orders/'))).toBe(true),
    );
    const url = String(get.mock.calls.find(([p]) => String(p).includes('/orders/'))![0]);
    expect(new URL(url, 'http://x').searchParams.get('status')).toBe('PREPARING');
  });

  // A rescheduled order goes back to PREPARING with its delivery row kept: never claimable,
  // so it leaves the list after the first refusal instead of coming back on every reload.
  it('drops an order that already has a delivery after the server says so', async () => {
    const ORDER = {
      id: 'o-1',
      orderNumber: 'HM-0001',
      addressLine: 'Jl. Satu 1',
      city: 'Bandung',
      statusChangedAt: '2026-11-20T01:00:00.000Z',
      items: [],
    };
    get.mockImplementation(async (path: string) =>
      String(path).includes('/settings')
        ? { courierSelfClaimEnabled: 1, courierSelfClaimWaitMinutes: 10 }
        : { items: [ORDER], total: 1, page: 1, limit: 20 },
    );
    post.mockRejectedValue(
      new ApiError(409, 'Pesanan ini sudah punya pengiriman.', 'DELIVERY_ALREADY_EXISTS'),
    );
    render(<ClaimableOrders depotId="d-1" onClaimed={vi.fn()} />, { wrapper: LocaleProvider });

    fireEvent.click(await screen.findByRole('button', { name: /ambil|claim/i }));

    await waitFor(() => expect(screen.queryByText(/HM-0001/)).toBeNull());
  });
});
