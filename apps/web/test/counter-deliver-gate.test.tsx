// @vitest-environment jsdom
/**
 * P1a — "Antar" with half an address sold a pick-up.
 *
 * The till sends no address until line, city and a number are all there, which is right for
 * the QUOTE. But the pay button stayed enabled, so a cashier who ticked Antar and missed the
 * city recorded a sale with no delivery behind it, and the buyer waited for a courier nobody
 * sent. The button now waits for the address, or for Antar to be turned off.
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

beforeEach(() => {
  post.mockReset().mockImplementation(async (path: string) =>
    String(path).includes('/walk-in/quote')
      ? { subtotalIdr: 20000, discountIdr: 0, totalIdr: 20000, agen: false, catalogFallback: null }
      : {},
  );
  patch.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('shift')) {
      return {
        id: 'shift-1',
        depotId: 'depot-1',
        cashierName: 'Kasir Satu',
        openingFloat: 200000,
        openedAt: '2026-08-25T01:00:00.000Z',
        status: 'OPEN',
      };
    }
    if (p.includes('/inventory')) {
      return [{ id: 'i1', productId: 'p-air', quantity: 12, reserved: 0, available: 12, minimum: 0 }];
    }
    if (p.includes('/orders/manage')) return { items: [], total: 0, page: 1, limit: 8 };
    if (p.includes('/products/batch')) return [PRODUCT];
    if (p.includes('/products')) return { items: [PRODUCT], total: 1, page: 1, limit: 100 };
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

const payButton = () => screen.getByRole('button', { name: /simpan & cetak struk/i });

describe('the till and a delivery address', () => {
  it('waits for the whole address once Antar is ticked, and pays again when it is complete', async () => {
    render(<WalkInPage />, { wrapper });
    const plus = await screen.findAllByRole('button', { name: /increase quantity/i });
    await userEvent.click(plus[0]!);
    await waitFor(() => expect(payButton()).toBeEnabled());

    await userEvent.click(screen.getByRole('checkbox', { name: /antar ke alamat pembeli/i }));
    await userEvent.type(screen.getByPlaceholderText(/alamat lengkap/i), 'Jl. Dago 1');
    // Street but no city or number: still a pick-up quote, and no longer sellable.
    expect(payButton()).toBeDisabled();
    expect(screen.getByText(/lengkapi dulu/i)).toBeTruthy();

    await userEvent.type(screen.getByPlaceholderText(/^kota$/i), 'Bandung');
    await userEvent.type(screen.getByPlaceholderText(/nomor yang bisa dihubungi/i), '081234567890');
    await waitFor(() => expect(payButton()).toBeEnabled());
  });

  it('sells a pick-up again as soon as Antar is turned off', async () => {
    render(<WalkInPage />, { wrapper });
    const plus = await screen.findAllByRole('button', { name: /increase quantity/i });
    await userEvent.click(plus[0]!);
    const toggle = await screen.findByRole('checkbox', { name: /antar ke alamat pembeli/i });

    await userEvent.click(toggle);
    expect(payButton()).toBeDisabled();
    await userEvent.click(toggle);
    await waitFor(() => expect(payButton()).toBeEnabled());
  });
});
