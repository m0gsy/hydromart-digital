// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-64, the console half.
 *
 * Two money bugs that a form shape caused, and one that a form shape can fix:
 *
 *  - An emptied unit-price box priced a purchase-order line at nothing. `Number('')` is 0,
 *    `Math.max(0, …)` waved it through, and the RECEIPT the PO posts carried that zero into
 *    COGS — a margin that looks better than it is, on a screen nobody re-checks.
 *  - Receiving was one button that booked in the FULL ordered quantity of every line. A
 *    supplier who sends 40 of 60 galon left the depot choosing between 20 units of stock
 *    that are not in the building and none of the 40 that are.
 */
const { get, getCached, post, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, patch, del },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/purchase-orders/detail',
  useSearchParams: () => new URLSearchParams('id=po-1'),
}));

import PoDetailPage from '@/app/dashboard/purchase-orders/detail/page';

const PO = {
  id: 'po-1',
  poNumber: 'PO-ABCD1234',
  depotId: 'd1',
  supplierId: 's1',
  supplierName: 'Tirta Makmur',
  status: 'SENT',
  lines: [
    { itemType: 'GALON', label: 'Galon 19L', quantity: 60, unitCostIdr: 18000 },
    { itemType: 'SEGEL', label: 'Segel', quantity: 100, unitCostIdr: 200 },
  ],
  subtotalIdr: 1_100_000,
  shippingIdr: 0,
  totalIdr: 1_100_000,
  expectedAt: null,
  receivedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

beforeEach(() => {
  for (const m of [get, getCached, post, patch, del]) m.mockReset();
  get.mockResolvedValue(PO);
  getCached.mockResolvedValue(PO);
  post.mockResolvedValue({});
});

describe('receiving a partial delivery (CA-2-64)', () => {
  it('sends only what arrived, per line', async () => {
    render(<PoDetailPage />);
    const boxes = await screen.findAllByLabelText(/arrivingFor/i);
    expect(boxes).toHaveLength(PO.lines.length);
    fireEvent.change(boxes[0]!, { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /receiveGoods|terima/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0]!;
    expect(String(url)).toContain('/receive');
    expect(body).toEqual({ received: { 0: 40, 1: 0 } });
  });

  /*
   * The single button has to keep working. A complete delivery is the common case and
   * nobody should have to type two numbers to say "all of it arrived" — an empty form
   * means "everything still outstanding", which is exactly what it always meant.
   */
  it('sends an empty body when nothing was typed, meaning everything outstanding', async () => {
    render(<PoDetailPage />);
    await screen.findAllByLabelText(/arrivingFor/i);
    fireEvent.click(screen.getByRole('button', { name: /receiveGoods|terima/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toEqual({});
  });
});
