// @vitest-environment jsdom
/*
 * K3.2 · "Pesanan tersimpan, pembayaran belum tercatat" is a dead end.
 *
 * The counter records the sale first and settles it second. When the settle half fails the
 * screen says so in a toast, clears the form and moves on: the order is already terminal,
 * it shows up in no outstanding-payment view anywhere, and it surfaces at shift close as a
 * cash difference nobody can explain. The cashier is still holding the money and the buyer
 * is still standing there — that is the best chance this payment will ever have of being
 * recorded, and the screen throws it away.
 *
 * Retrying has to be idempotent: `initiate` already refuses a second row for an order that
 * has an active payment (PAYMENT_ALREADY_EXISTS), so a retry after a lost initiate answer
 * must confirm the row the server already has instead of trying to mint another.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard/walk-in',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 's1', role: 'KEPALA_DEPOT', assignedDepotId: 'depot-1' },
    ready: true,
  }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post, patch } };
});
vi.mock('@/lib/receipt', () => ({ printReceipt: () => true }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'depot-1', ready: true, error: null, reload: vi.fn(), depots: [] }),
}));
vi.mock('@/lib/roles', async () => {
  const actual = await vi.importActual<typeof import('@/lib/roles')>('@/lib/roles');
  return { ...actual, canRecordWalkInSale: () => true };
});

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

const AIR = {
  id: 'p-air',
  name: 'Air Galon 19L',
  basePrice: 20000,
  unit: 'Galon',
  isGallon: true,
  imageUrl: null,
  categoryId: null,
};

const ORDER = {
  id: 'o-1',
  orderNumber: 'WI-001',
  total: 20000,
  customerId: null,
  status: 'COMPLETED',
};

/** Every settle call the screen made, in order, so a retry can be proved not to double-sell. */
let calls: string[] = [];
/** How the confirm leg answers, attempt by attempt. */
let confirmFails: boolean[] = [];
let initiateFails: 'no' | 'network' | 'conflict' = 'no';
let existingPayments: Array<{ id: string; status: string }> = [];

beforeEach(() => {
  calls = [];
  confirmFails = [true];
  initiateFails = 'no';
  existingPayments = [];
  post.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/walk-in/quote')) {
      return {
        subtotalIdr: 20000,
        discountIdr: 0,
        totalIdr: 20000,
        agen: false,
        catalogFallback: null,
      };
    }
    if (p.includes('/products/batch')) return [AIR];
    if (p.endsWith('/orders/walk-in')) {
      calls.push('sale');
      return ORDER;
    }
    if (p.endsWith('/payments/staff')) {
      calls.push('initiate');
      if (initiateFails === 'conflict') {
        throw new ApiError(
          409,
          'This order already has an active payment.',
          'PAYMENT_ALREADY_EXISTS',
        );
      }
      if (initiateFails === 'network') throw new Error('offline');
      return { id: 'pay-1' };
    }
    if (p.includes('/confirm')) {
      calls.push('confirm:' + (p.split('/').at(-2) ?? ''));
      if (confirmFails.shift()) throw new Error('offline');
      return {};
    }
    return {};
  });
  patch.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    // K3.3: the pay button now waits for the shift read instead of assuming a shift is
    // open while it is in flight. These cases are about what happens AFTER the cashier
    // presses Bayar, so the shift has to answer.
    if (p.includes('shift')) {
      return {
        id: 's-1',
        depotId: 'depot-1',
        cashierId: 's1',
        cashierName: 'Rina',
        status: 'OPEN',
        openingFloat: 0,
        openedAt: '2026-08-25T08:00:00.000Z',
        closedAt: null,
        countedCash: null,
        expectedCash: null,
        variance: null,
        note: null,
      };
    }
    if (p.includes('/inventory')) {
      return [
        { id: 'i1', productId: 'p-air', quantity: 12, reserved: 0, available: 12, minimum: 0 },
      ];
    }
    if (p.includes('/orders/manage')) return { items: [], total: 0, page: 1, limit: 8 };
    if (p.includes('/payments/for-order/')) {
      calls.push('read-payments');
      return { items: existingPayments, total: existingPayments.length, page: 1, limit: 20 };
    }
    if (p.includes('/products/batch')) return [AIR];
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

/** Ring up one galon, hand over exact money, press Bayar. */
async function sellOne() {
  const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
  render(<WalkInPage />, { wrapper });
  await waitFor(() => expect(screen.getByText('Air Galon 19L')).toBeTruthy());
  await userEvent.click(screen.getAllByRole('button', { name: /Increase quantity/i })[0]!);
  await waitFor(() => expect(screen.getByLabelText(/uang tunai diterima/i)).toBeTruthy());
  await userEvent.type(screen.getByLabelText(/uang tunai diterima/i), '20000');
  await userEvent.click(screen.getByRole('button', { name: /simpan & cetak struk/i }));
}

describe('K3.2 · an unrecorded payment stays on the counter screen until it is settled', () => {
  it('offers the cashier a retry instead of a toast that scrolls away', async () => {
    await sellOne();
    await waitFor(() => expect(screen.getByRole('button', { name: /coba lagi/i })).toBeTruthy());
    // And it names the order, so the cashier can say which sale is unpaid.
    expect(screen.getAllByText(/WI-001/).length).toBeGreaterThan(0);
  });

  it('confirms the payment the failed attempt already created, without selling twice', async () => {
    await sellOne();
    const retry = await screen.findByRole('button', { name: /coba lagi/i });
    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: /coba lagi/i })).toBeNull());
    // One sale, one payment row, two confirms of THAT row.
    expect(calls).toEqual(['sale', 'initiate', 'confirm:pay-1', 'confirm:pay-1']);
  });

  it('confirms the row the server already has when the lost answer was the initiate', async () => {
    initiateFails = 'network';
    confirmFails = [false];
    await sellOne();
    const retry = await screen.findByRole('button', { name: /coba lagi/i });
    // The first initiate DID land server-side; its answer is what was lost.
    initiateFails = 'conflict';
    existingPayments = [{ id: 'pay-9', status: 'PENDING' }];
    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: /coba lagi/i })).toBeNull());
    expect(calls).toEqual(['sale', 'initiate', 'initiate', 'read-payments', 'confirm:pay-9']);
  });

  it('keeps the retry on screen when it fails again', async () => {
    confirmFails = [true, true];
    await sellOne();
    await userEvent.click(await screen.findByRole('button', { name: /coba lagi/i }));
    await waitFor(() => expect(calls.filter((c) => c.startsWith('confirm')).length).toBe(2));
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeTruthy();
  });
});
