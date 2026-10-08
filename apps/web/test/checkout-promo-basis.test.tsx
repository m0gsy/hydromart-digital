// @vitest-environment jsdom
/*
 * Item 5 — checkout applies the automatic promos, so this screen has to price vouchers and
 * delivery on the same basis the server does: the voucher on the POST-promo goods, the
 * minimum-order test on the PRE-promo subtotal, and ongkir at the promo's per-galon fee on
 * every galon including the free ones.
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

const CART: Record<string, unknown> = {
  items: [line(10_000)],
  subtotal: 10_000,
  depotId: 'd-1',
  pricingBasis: 'DEPOT',
  reseller: null,
  promo: {
    subtotal: 8_000,
    savings: 2_000,
    lines: [{ productId: 'p1', unitPriceAfter: 10_000, freeQty: 1 }],
    shippingFeeOverride: 1_000,
  },
};

const serve = () => {
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/cart')) return CART;
    if (p.includes('/depots/api/v1/depots?')) {
      return { items: [depotRow('d-1', 'Depot Satu', 5_000)], total: 1, page: 1, limit: 100 };
    }
    if (p.includes('delivery-options')) return { expressEnabled: false, expressFee: 0, slots: [] };
    if (p.includes('/loyalty/')) return { tier: 'REGULAR', discountRate: 0, pointsBalance: 0 };
    return [];
  });
};

const quoteCalls = () =>
  post.mock.calls.filter(([p]) => String(p).includes('vouchers') && String(p).includes('quote'));

beforeEach(() => {
  post.mockReset().mockResolvedValue({ code: 'HEMAT', discount: 500, discountType: 'FIXED' });
  patch.mockReset().mockResolvedValue({});
  serve();
});
afterEach(() => vi.clearAllMocks());

describe('checkout prices on the post-promo basket (item 5)', () => {
  it('quotes the voucher on the post-promo subtotal and the promo delivery fee for paid + free galons', async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <ToastProvider>
          <CheckoutPage />
        </ToastProvider>
      </LocaleProvider>,
    );
    await screen.findAllByText(/Depot Satu/);
    await user.click(screen.getAllByText(/^Voucher$/)[0]!);
    await user.type(screen.getByLabelText(/kode voucher/i), 'HEMAT');
    await user.click(screen.getByRole('button', { name: /Terapkan/i }));
    await waitFor(() => expect(quoteCalls().length).toBe(1));

    // 10.000 less the 2.000 promo; ongkir = min(promo 1.000, depot 5.000) x (1 paid + 1 free) galons.
    expect(quoteCalls()[0]![1]).toMatchObject({ subtotal: 8_000, shippingFee: 2_000 });
  });

  it('shows the order discount and the gifts the basket earns', async () => {
    get.mockReset().mockImplementation(async (path: string) => {
      const p = String(path);
      if (p.includes('/cart')) {
        return {
          ...CART,
          promo: {
            subtotal: 8_000,
            savings: 2_000,
            lines: [],
            shippingFeeOverride: null,
            orderDiscount: 1_000,
            gifts: [{ productId: 'g1', productName: 'Botol 600ml', quantity: 2 }],
          },
        };
      }
      if (p.includes('/depots/api/v1/depots?')) {
        return { items: [depotRow('d-1', 'Depot Satu', 5_000)], total: 1, page: 1, limit: 100 };
      }
      if (p.includes('delivery-options')) return { expressEnabled: false, expressFee: 0, slots: [] };
      if (p.includes('/loyalty/')) return { tier: 'REGULAR', discountRate: 0, pointsBalance: 0 };
      return [];
    });
    render(
      <LocaleProvider>
        <ToastProvider>
          <CheckoutPage />
        </ToastProvider>
      </LocaleProvider>,
    );
    expect((await screen.findAllByText('Diskon belanja')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Gratis 2× Botol 600ml').length).toBeGreaterThan(0);
  });
});
