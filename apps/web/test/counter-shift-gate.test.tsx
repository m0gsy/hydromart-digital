// @vitest-environment jsdom
/*
 * K3.3 — the pay button was left ENABLED while the shift status was still UNKNOWN,
 * defended in the code as "a slow check never blocks a queue of buyers, and the server
 * refuses anyway".
 *
 * The server does refuse, so nothing was ever sold twice. What the cashier got instead was
 * a refusal with no reason, in front of the buyer, because a read had not landed yet.
 * Waiting and saying so is the same protection with an explanation attached.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
/** Resolved by the test when the shift read should answer. */
const shiftGate = vi.hoisted(() => ({ release: null as ((v: unknown) => void) | null }));

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
  useDepot: () => ({
    scopedId: 'depot-1',
    ready: true,
    error: null,
    reload: vi.fn(),
    depots: [{ id: 'depot-1', name: 'Depot Cibubur', city: 'Bandung', code: 'CBB' }],
  }),
}));
vi.mock('@/lib/roles', async () => {
  const actual = await vi.importActual<typeof import('@/lib/roles')>('@/lib/roles');
  return { ...actual, canRecordWalkInSale: () => true };
});

import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';
import WalkInPage from '@/app/dashboard/walk-in/page';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

const PRODUCT = {
  id: 'p-air',
  name: 'Air Galon 19L',
  basePrice: 20000,
  unit: 'Galon',
  isGallon: true,
  imageUrl: null,
  categoryId: null,
};

/** The shift read hangs until the test releases it, which is the window K3.3 is about. */
function pendingShift() {
  return new Promise((resolve) => {
    shiftGate.release = resolve;
  });
}

beforeEach(() => {
  shiftGate.release = null;
  post.mockReset().mockImplementation(async (path: string) => {
    if (String(path).includes('/walk-in/quote')) {
      return {
        subtotalIdr: 20000,
        discountIdr: 0,
        totalIdr: 20000,
        agen: false,
        catalogFallback: null,
      };
    }
    return {};
  });
  patch.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('shift')) return pendingShift();
    // One stocked product, so the basket can hold a line — without one the button is
    // disabled for a reason that has nothing to do with the shift, and this file would be
    // asserting the wrong thing.
    if (p.includes('/inventory')) {
      return [
        { id: 'i1', productId: 'p-air', quantity: 12, reserved: 0, available: 12, minimum: 0 },
      ];
    }
    if (p.includes('/orders/manage')) return { items: [], total: 0, page: 1, limit: 8 };
    if (p.includes('/products/batch')) return [PRODUCT];
    if (p.includes('/products')) return { items: [PRODUCT], total: 1, page: 1, limit: 100 };
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

const payButton = () =>
  screen.getByRole('button', { name: /simpan|bayar|cetak|memeriksa shift|checking the shift/i });

/*
 * The other half of K3.3, and the half the e2e caught: once the read ANSWERS with an open
 * shift, the button has to come back. Everything above asserts the waiting state, so a
 * gate that never opens passed all of it.
 */
describe('K3.3 · the pay button once the shift has answered', () => {
  const OPEN_SHIFT = {
    id: 'shift-1',
    depotId: 'depot-1',
    cashierName: 'Kasir Satu',
    openingFloat: 200000,
    openedAt: '2026-08-25T01:00:00.000Z',
    status: 'OPEN',
  };

  it('enables itself when a shift is already open at this till', async () => {
    get.mockImplementation(async (path: string) => {
      const p = String(path);
      if (p.includes('shift')) return OPEN_SHIFT;
      if (p.includes('/inventory')) {
        return [
          { id: 'i1', productId: 'p-air', quantity: 12, reserved: 0, available: 12, minimum: 0 },
        ];
      }
      if (p.includes('/orders/manage')) return { items: [], total: 0, page: 1, limit: 8 };
      if (p.includes('/products/batch')) return [PRODUCT];
      if (p.includes('/products')) return { items: [PRODUCT], total: 1, page: 1, limit: 100 };
      return [];
    });
    render(<WalkInPage />, { wrapper });
    const plus = await screen.findAllByRole('button', { name: /increase quantity/i });
    await userEvent.click(plus[0]!);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /simpan & cetak struk/i })).toBeEnabled(),
    );
  });
});

describe('K3.3 · the pay button and a shift nobody has answered for yet', () => {
  /** Puts one line in the basket, so the button is not disabled for an unrelated reason. */
  async function ringUpOne() {
    render(<WalkInPage />, { wrapper });
    const plus = await screen.findAllByRole('button', { name: /increase quantity/i });
    await userEvent.click(plus[0]!);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/walk-in/quote'),
        expect.anything(),
        true,
      ),
    );
  }

  it('is disabled while the shift read is still in flight, WITH a full basket', async () => {
    await ringUpOne();

    expect(payButton()).toBeDisabled();
  });

  /*
   * Disabled AND explained. A disabled button with the ordinary label is the same mystery
   * as an unexplained refusal, just earlier.
   */
  it('says it is checking, rather than going quiet', async () => {
    render(<WalkInPage />, { wrapper });

    expect(await screen.findByText(/memeriksa shift|checking the shift/i)).toBeTruthy();
  });

  it('does not send anything while it is waiting', async () => {
    render(<WalkInPage />, { wrapper });

    await waitFor(() => expect(payButton()).toBeTruthy());
    expect(post).not.toHaveBeenCalledWith(
      expect.stringContaining('/walk-in'),
      expect.anything(),
      true,
    );
  });
});
