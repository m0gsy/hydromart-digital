// @vitest-environment jsdom
/**
 * C14 · the number on the till was stale from the FIRST sale.
 *
 * `stock` only reloaded on a depot switch, a void, a retry after an error, or `useAsync`'s
 * resume-after-60-seconds-backgrounded. A successful sale never reloaded it — and the
 * server computes `available = quantity - reserved`, with every walk-in reserving. So ONE
 * cashier was enough: sell 10 of a stock of 12 and the stepper still offered 12, the
 * cashier kept selling goods that were gone, and the reservation refused them AFTER the
 * buyer had agreed a price.
 *
 * The naive fix is worse than the bug, which is why the first test here is about the
 * skeleton: `reload()` turns `loading` back on, and the whole till was gated on it.
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
  useAuth: () => ({ customer: { id: 's1', role: 'KEPALA_DEPOT', assignedDepotId: 'depot-1' }, ready: true }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post, patch } };
});

// The struk opens a print window and needs the full order shape; neither is what C14 is
// about, and chasing every receipt field here would test the fixture, not the till.
vi.mock('@/lib/receipt', () => ({ printReceipt: () => true }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'depot-1', ready: true, error: null, reload: vi.fn(), depots: [] }),
}));
// Capability resolution needs a loaded session; the gate itself is not what this tests.
vi.mock('@/lib/roles', async () => {
  const actual = await vi.importActual<typeof import('@/lib/roles')>('@/lib/roles');
  return { ...actual, canRecordWalkInSale: () => true };
});

import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

/** The screen toasts on every refusal, so both providers have to be real. */
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

const PRODUCT = {
  id: 'p1',
  name: 'Galon 19L',
  basePrice: 20000,
  unit: 'Galon',
  isGallon: true,
  imageUrl: null,
  categoryId: null,
};

/** available = quantity - reserved, exactly as depot-service computes it. */
const stockLines = (available: number) => [
  { id: 'i1', productId: 'p1', quantity: available, reserved: 0, available, minimum: 0 },
];

let stockAvailable = 12;
/** Set to make the SALE fail — the quote must still answer, or Bayar never enables. */
let walkInError: Error | null = null;

beforeEach(() => {
  stockAvailable = 12;
  walkInError = null;
  // C12: Bayar is disabled until the server quote lands, so the quote has to answer here
  // or no test in this file can ever reach submit.
  post.mockReset().mockImplementation(async (path: string) => {
    if (path.includes('/walk-in/quote')) {
      return { subtotalIdr: 20000, discountIdr: 0, totalIdr: 20000, agen: false, catalogFallback: null };
    }
    if (path.includes('/orders/walk-in') && walkInError) throw walkInError;
    // `items` matters: the receipt renderer maps over it, and an order without one throws
    // out of the print step — a real order always has lines.
    return {
      id: 'ord-1',
      orderNumber: 'HM-1',
      total: 20000,
      subtotal: 20000,
      discount: 0,
      deliveryFee: 0,
      customerId: 'c1',
      items: [{ id: 'oi1', productId: 'p1', productName: 'Galon 19L', quantity: 1, unitPrice: 20000, lineTotal: 20000 }],
    };
  });
  patch.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) => {
    if (path.includes('/inventory')) return stockLines(stockAvailable);
    if (path.includes('/products')) return { items: [PRODUCT], total: 1, page: 1, limit: 100 };
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

describe('C14 · a refresh must not blank the till', () => {
  /**
   * The trap that would have made a naive fix worse than the bug: the whole render was
   * gated on `catalog.loading || stock.loading`, and `reload()` turns `loading` back on.
   * Any refresh mid-transaction wiped the last-sale card, its Cetak ulang and its Batalkan.
   */
  it('keeps the screen up while stock is re-reading', async () => {
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });

    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());

    // A reload with data already present must not fall back to the skeleton.
    stockAvailable = 2;
    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());
  });
});

describe('C14 · the ceiling follows what is really there', () => {
  /**
   * The heart of C14, and the part the plan's own note corrected: this needs ONE cashier.
   * A successful sale reserves stock, so the number on screen and the stepper's ceiling are
   * both wrong the moment it lands — `submit()` never reloaded them.
   */
  it('re-reads stock after a sale, not only when the depot changes', async () => {
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());

    await userEvent.click(screen.getAllByRole('button', { name: /Increase quantity/i })[0]!);
    const before = get.mock.calls.filter((c) => String(c[0]).includes("/inventory")).length;

    // The cash guard uses the SERVER total (C12); without cash in the box submit stops here.
    await userEvent.type(screen.getByLabelText(/Uang tunai diterima/i), '50000');
    await userEvent.click(await screen.findByRole('button', { name: /Simpan & cetak/i }));

    await waitFor(() => {
      const after = get.mock.calls.filter((c) => String(c[0]).includes("/inventory")).length;
      expect(after).toBeGreaterThan(before);
    });
  });
});

describe('C14 · a stock refusal is readable, and retryable', () => {
  /**
   * The 422 arrived as "Insufficient stock at the fulfilling depot: <uuid> (need 5, have 2)"
   * printed straight onto the till — it DOES name every short line, but with catalogue ids
   * nobody at a counter can read. And the basket survived alongside the STALE ceiling, so
   * trying again failed identically; the only way to fresh numbers was reloading the page,
   * which threw away the basket and the buyer's phone number.
   */
  it('says it in the cashier’s language and refreshes the numbers', async () => {
    const { ApiError } = await import('@/lib/api');
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    const { id: idDict } = await import('@/lib/dictionaries/id');

    render(<WalkInPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());

    // Only the SALE fails. Rejecting the next post outright would have been consumed by the
    // C12 quote instead — and the quote failing disables Bayar, so nothing would submit.
    walkInError = new ApiError(
      422,
      'Insufficient stock at the fulfilling depot: 8f1c… (need 5, have 2)',
      'ORDER_INSUFFICIENT_STOCK',
    );

    await userEvent.click(screen.getAllByRole('button', { name: /Increase quantity/i })[0]!);
    await userEvent.type(screen.getByLabelText(/Uang tunai diterima/i), '50000');
    const pay = await screen.findByRole('button', { name: /Simpan & cetak/i });
    const before = get.mock.calls.filter((c) => String(c[0]).includes("/inventory")).length;
    await userEvent.click(pay);

    await waitFor(() => expect(screen.getByText(idDict.opsFix.walkIn.stockShort)).toBeTruthy());
    const after = get.mock.calls.filter((c) => String(c[0]).includes("/inventory")).length;
    expect(after).toBeGreaterThan(before);
  });
});

describe('C8 · a basket edit retires the till attempt key', () => {
  /**
   * B-13 keeps the key across a FAILED submit on purpose, so a retry after a timeout
   * returns the sale already recorded instead of selling the goods twice. C8 is the other
   * half: it must not survive a change of BASKET, or the same key describes two different
   * sales and the server hands back the wrong one.
   *
   * So the scenario is exactly the bug's: submit fails, cashier edits the basket, submits
   * again. The key that goes out the second time has to be a different one.
   */
  it('keeps the key on a failed retry, and drops it once the basket changes', async () => {
    const { default: WalkInPage } = await import('@/app/dashboard/walk-in/page');
    render(<WalkInPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());

    const increase = () => screen.getAllByRole('button', { name: /Increase quantity/i })[0]!;
    const pay = () => screen.findByRole('button', { name: /Simpan & cetak/i });
    const keys = () =>
      post.mock.calls
        .filter((c) => String(c[0]).endsWith('/orders/walk-in'))
        .map((c) => (c[3] as Record<string, string> | undefined)?.['Idempotency-Key']);

    walkInError = new Error('depot-service down');
    await userEvent.click(increase());
    await userEvent.type(screen.getByLabelText(/Uang tunai diterima/i), '50000');
    await userEvent.click(await pay());
    await waitFor(() => expect(keys()).toHaveLength(1));

    // A true retry — nothing changed — must reuse the key (B-13).
    await userEvent.click(await pay());
    await waitFor(() => expect(keys()).toHaveLength(2));
    expect(keys()[1]).toBe(keys()[0]);

    // The buyer changes their mind. Same key would mean the same sale, and it is not.
    await userEvent.click(increase());
    await userEvent.click(await pay());

    await waitFor(() => expect(keys()).toHaveLength(3));
    expect(keys()[2]).not.toBe(keys()[0]);
  });
});
