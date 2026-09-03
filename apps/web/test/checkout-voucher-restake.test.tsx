// @vitest-environment jsdom
/*
 * CA-3-12 / CA-3-13 — the voucher quote outlived the numbers it was priced against.
 *
 * A quote answers one question: "what is this code worth on a subtotal of X with an ongkir
 * of Y". Both belong to the DEPOT. Change the depot and the cart is re-read at that depot's
 * prices — but the quote kept the old answer, and the screen went on subtracting it. The
 * total under the button was not the bill.
 *
 * The agen case is the same defect wearing a different hat: reseller status is resolved per
 * depot, so a voucher applied before the switch survived it, while `placeOrder` does not
 * even send the code to a reseller. The preview promised a discount the order dropped.
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
// No map pin, so checkout offers the depot PICKER — which is how a shopper changes depot
// mid-checkout, the move this whole file is about.
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

const depotRow = (id: string, name: string, deliveryFee: number) => ({
  id,
  code: id.toUpperCase(),
  name,
  city: 'Jakarta',
  province: 'DKI',
  lat: -6.2,
  lng: 106.8,
  serviceRadiusKm: 10,
  deliveryFee,
  minOrderAmount: null,
  distanceKm: 1,
  withinService: true,
  operatingHours: undefined,
  holidays: [],
});

const line = (unitPrice: number) => ({
  productId: 'p1',
  productName: 'Galon 19L',
  sku: 'AIR-19L',
  unit: 'Galon 19L',
  unitPrice,
  quantity: 1,
  lineTotal: unitPrice,
  isGallon: true,
});

/** Depot 2 runs a +10% rule, so the same basket is a different subtotal there. */
const CARTS: Record<string, unknown> = {
  'd-1': {
    items: [line(20_000)],
    subtotal: 20_000,
    depotId: 'd-1',
    pricingBasis: 'DEPOT',
    reseller: null,
  },
  'd-2': {
    items: [line(22_000)],
    subtotal: 22_000,
    depotId: 'd-2',
    pricingBasis: 'DEPOT',
    reseller: null,
  },
};

const serve = (carts: Record<string, unknown> = CARTS) => {
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/cart')) {
      const m = p.match(/depotId=([^&]+)/);
      return carts[m?.[1] ?? 'd-1'] ?? carts['d-1'];
    }
    if (p.includes('/depots/api/v1/depots?')) {
      return {
        items: [depotRow('d-1', 'Depot Satu', 5_000), depotRow('d-2', 'Depot Dua', 9_000)],
        total: 2,
        page: 1,
        limit: 100,
      };
    }
    if (p.includes('delivery-options')) return { expressEnabled: false, expressFee: 0, slots: [] };
    if (p.includes('/loyalty/')) return { tier: 'REGULAR', discountRate: 0, pointsBalance: 0 };
    if (p.includes('/addresses')) return [];
    return [];
  });
};

const quoteCalls = () =>
  post.mock.calls.filter(([p]) => String(p).includes('vouchers') && String(p).includes('quote'));

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

/** Voucher and depot each live behind a sheet, so every interaction opens one first. */
const openSheet = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(screen.getAllByText(name)[0]!);
};

const applyVoucher = async (user: ReturnType<typeof userEvent.setup>) => {
  await openSheet(user, /^Voucher$/);
  await user.type(screen.getByLabelText(/kode voucher/i), 'HEMAT5K');
  await user.click(screen.getByRole('button', { name: /Terapkan/i }));
  await waitFor(() => expect(quoteCalls().length).toBe(1));
};

const pickDepot = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await openSheet(user, /Pilih depot pengantar/);
  // Inside the picker, not the summary row that also names the chosen depot.
  const picker = await screen.findByTestId('depot-picker');
  const row = [...picker.querySelectorAll('span')].find((el) => el.textContent === name);
  await user.click(row!);
};

beforeEach(() => {
  post.mockReset().mockResolvedValue({ code: 'HEMAT5K', discount: 5_000, discountType: 'FIXED' });
  patch.mockReset().mockResolvedValue({});
  serve();
});
afterEach(() => vi.clearAllMocks());

describe('a voucher quote does not outlive its depot (CA-3-12)', () => {
  it('re-asks for the quote when the shopper switches depot', async () => {
    const user = userEvent.setup();
    await draw();
    await applyVoucher(user);

    // The first quote was priced against depot 1: subtotal 20.000, ongkir 5.000.
    expect(quoteCalls()[0]![1]).toMatchObject({ subtotal: 20_000, shippingFee: 5_000 });

    await pickDepot(user, 'Depot Dua');

    // Depot 2 prices the same basket at 22.000 and charges 9.000 to deliver, so the
    // question changed and the answer has to be asked again.
    await waitFor(() => expect(quoteCalls().length).toBe(2));
    expect(quoteCalls()[1]![1]).toMatchObject({ subtotal: 22_000, shippingFee: 9_000 });
  });

  it('asks once and stays put when nothing about the price moved', async () => {
    const user = userEvent.setup();
    await draw();
    await applyVoucher(user);

    // Re-selecting the depot already chosen is not a price change, and a quote loop on a
    // money screen would be worse than the stale number it replaced.
    await pickDepot(user, 'Depot Satu');
    await new Promise((r) => setTimeout(r, 50));
    expect(quoteCalls().length).toBe(1);
  });
});

describe('an agen price cancels the voucher preview (CA-3-13)', () => {
  it('stops subtracting a voucher the order will not honour', async () => {
    const user = userEvent.setup();
    // Depot 2 is where this shopper is an agen: flat price, no voucher stacking.
    serve({
      ...CARTS,
      'd-2': {
        items: [line(15_000)],
        subtotal: 15_000,
        depotId: 'd-2',
        pricingBasis: 'DEPOT',
        reseller: { applies: true, discount: 5_000, discountPct: 25, flatGallonPriceIdr: 15_000 },
      },
    });
    await draw();
    await applyVoucher(user);

    await pickDepot(user, 'Depot Dua');

    // The agen card replaces the voucher field — that part already worked. What did not is
    // the number: the discount line for a voucher must be gone, not merely hidden behind
    // a card while it goes on being subtracted from the total.
    await waitFor(() =>
      expect(screen.getAllByText(/Harga agen|Diskon agen/i).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/HEMAT5K/)).toBeNull();
  });
});
