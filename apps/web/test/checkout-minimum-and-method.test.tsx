// @vitest-environment jsdom
/*
 * CA-3-20 / CA-3-22 — two ways checkout let a customer press a button that could not work.
 *
 * The depot's minimum order was never said out loud. The customer filled the form in, read
 * a total, pressed the button that spends money, and got a 422 written in English by a
 * domain error nobody meant them to read.
 *
 * The payment method was chosen once and never re-checked. The list it came from narrows
 * whenever the depot changes — a transfer needs THAT depot's bank account, a QRIS is THAT
 * depot's printed code — so a customer who picked QRIS and then switched depot kept a
 * selection the picker no longer offered.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu' }, ready: true }),
}));
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: { depotId: 'd-1' } }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/checkout',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import CheckoutPage from '@/app/checkout/page';

const depotRow = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  code: id.toUpperCase(),
  name,
  city: 'Jakarta',
  province: 'DKI',
  lat: -6.2,
  lng: 106.8,
  serviceRadiusKm: 10,
  deliveryFee: 5_000,
  minOrderAmount: null,
  distanceKm: 1,
  withinService: true,
  acceptsTransfer: true,
  acceptsQris: true,
  operatingHours: undefined,
  holidays: [],
  ...over,
});

const CART = {
  items: [
    {
      productId: 'p1',
      productName: 'Galon 19L',
      sku: 'AIR-19L',
      unit: 'Galon 19L',
      unitPrice: 20_000,
      quantity: 1,
      lineTotal: 20_000,
      isGallon: true,
    },
  ],
  subtotal: 20_000,
  depotId: 'd-1',
  pricingBasis: 'DEPOT',
  reseller: null,
};

const serve = (depots: unknown[]) => {
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/cart')) return CART;
    if (p.includes('/depots/api/v1/depots?')) {
      return { items: depots, total: depots.length, page: 1, limit: 100 };
    }
    if (p.includes('delivery-options')) return { expressEnabled: false, expressFee: 0, slots: [] };
    if (p.includes('/loyalty/')) return { tier: 'REGULAR', discountRate: 0, pointsBalance: 0 };
    if (p.includes('/addresses')) return [];
    /*
     * The PLATFORM's answer. Returning `[]` for it — the old catch-all — made
     * `available[m.value]` undefined for every method, so `offeredMethods` filtered the
     * whole list away and the picker had nothing in it.
     */
    if (p.includes('payment-methods') || p.includes('/methods')) {
      return { CASH: true, TRANSFER: true, QRIS: true, EWALLET: false, VA: false };
    }
    return [];
  });
};

const draw = async () => {
  render(
    <LocaleProvider>
      <ToastProvider>
        <CheckoutPage />
      </ToastProvider>
    </LocaleProvider>,
  );
  await screen.findAllByText(/Depot Satu/);
};

const submitButtons = () => screen.getAllByRole('button', { name: /Buat pesanan/i });

const pickDepot = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getAllByText(/Pilih depot pengantar/)[0]!);
  const picker = await screen.findByTestId('depot-picker');
  const row = [...picker.querySelectorAll('span')].find((el) => el.textContent === name);
  await user.click(row!);
};

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe("the depot's minimum order is said before the button (CA-3-20)", () => {
  it('names the minimum, the shortfall, and refuses the button', async () => {
    serve([depotRow('d-1', 'Depot Satu', { minOrderAmount: 50_000 })]);
    await draw();

    // Rp50.000 minimum against a Rp20.000 basket: Rp30.000 short, said in Indonesian,
    // while there is still something the customer can do about it.
    expect(await screen.findAllByText(/Minimum pesanan di depot ini Rp 50.000/)).toBeTruthy();
    expect(screen.getAllByText(/Kurang Rp 30.000 lagi/).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(submitButtons().every((b) => (b as HTMLButtonElement).disabled)).toBe(true),
    );
  });

  it('says nothing and allows the order when the depot has no minimum', async () => {
    serve([depotRow('d-1', 'Depot Satu')]);
    await draw();

    expect(screen.queryByText(/Minimum pesanan/)).toBeNull();
    await waitFor(() =>
      expect(submitButtons().some((b) => !(b as HTMLButtonElement).disabled)).toBe(true),
    );
  });
});

describe('a payment method the new depot cannot take is dropped (CA-3-22)', () => {
  it('falls back to a method still on offer, and says it changed', async () => {
    serve([
      depotRow('d-1', 'Depot Satu'),
      depotRow('d-2', 'Depot Dua', { acceptsQris: false, acceptsTransfer: false }),
    ]);
    const user = userEvent.setup();
    await draw();

    // Pick QRIS at depot 1, which accepts it.
    await user.click(screen.getAllByText(/Metode pembayaran/)[0]!);
    await user.click(await screen.findByText(/^QRIS$/));
    await user.keyboard('{Escape}');

    // Depot 2 has neither a bank account nor a QRIS code: cash is all that is left.
    await pickDepot(user, 'Depot Dua');

    await user.click(screen.getAllByText(/Metode pembayaran/)[0]!);
    await waitFor(() => expect(screen.getByText(/tidak tersedia di depot ini/i)).toBeTruthy());
    expect(screen.queryByText(/^QRIS$/)).toBeNull();
  });
});
