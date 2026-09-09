// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-56 — an order routed to the wrong depot was stuck there for good.
 *
 * `assignDepot` refuses anything that already has a depot, and nothing else could change
 * one. The picker existed only on the "unrouted" tray, so once an order left that tray its
 * depot was final. The operator's outs were to cancel the order — losing the customer's
 * order and any payment already taken — or to let the wrong depot deliver it.
 *
 * The same control now serves both acts, and the row decides which: a blank depot is an
 * assignment, an existing one is a move that releases the old hold and takes a new one.
 */

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, patch, post: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/orders',
  useSearchParams: () => new URLSearchParams(),
}));

import OrdersPage from '@/app/hq/orders/page';

const ROUTED = {
  id: 'o-1',
  orderNumber: 'HM-260909-001',
  recipientName: 'Budi',
  phone: '0812',
  status: 'CONFIRMED',
  total: 40000,
  createdAt: '2026-09-09T01:00:00.000Z',
  depotId: 'd-1',
};
const UNROUTED = { ...ROUTED, id: 'o-2', orderNumber: 'HM-260909-002', depotId: null };

const DEPOTS = {
  items: [
    { id: 'd-1', name: 'Jakarta Pusat', city: 'Jakarta' },
    { id: 'd-2', name: 'Bogor', city: 'Bogor' },
  ],
};

function serve(rows: unknown[]) {
  get.mockReset().mockImplementation((raw: unknown) => {
    const path = String(raw ?? '');
    if (path.includes('/depots')) return Promise.resolve(DEPOTS);
    return Promise.resolve({ items: rows, total: rows.length, page: 1, limit: 20 });
  });
}

beforeEach(() => {
  patch.mockReset().mockResolvedValue({});
});

describe('CA-2-56 a misrouted order can be moved', () => {
  it('sends a routed order to the MOVE route, with the new depot', async () => {
    serve([ROUTED]);
    render(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('HM-260909-001')).toBeTruthy());

    await userEvent.selectOptions(screen.getByLabelText('hq.orders.move'), 'd-2');

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[0]).toBe('/orders/api/v1/orders/manage/o-1/depot/move');
    expect(patch.mock.calls[0]?.[1]).toEqual({ depotId: 'd-2' });
  });

  it('still uses the ASSIGN route for an order that has no depot yet', async () => {
    serve([UNROUTED]);
    render(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('HM-260909-002')).toBeTruthy());

    await userEvent.selectOptions(screen.getByLabelText('hq.orders.assign'), 'd-2');

    await waitFor(() => expect(patch).toHaveBeenCalled());
    // Filling a blank is not the same act as moving a live order, and it must not
    // release a hold that was never taken.
    expect(patch.mock.calls[0]?.[0]).toBe('/orders/api/v1/orders/manage/o-2/depot');
  });

  it('repeats the server’s refusal instead of a generic one', async () => {
    serve([ROUTED]);
    patch.mockRejectedValue(new Error('Insufficient stock at the fulfilling depot'));
    render(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('HM-260909-001')).toBeTruthy());

    await userEvent.selectOptions(screen.getByLabelText('hq.orders.move'), 'd-2');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Insufficient stock'),
    );
  });

  it('offers the control on every row, not only on the unrouted tray', async () => {
    serve([ROUTED]);
    render(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('HM-260909-001')).toBeTruthy());
    // The whole defect was that this control existed only where a depot was still blank.
    expect(screen.getByLabelText('hq.orders.move')).toBeTruthy();
  });
});
