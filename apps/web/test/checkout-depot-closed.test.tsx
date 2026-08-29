// @vitest-environment jsdom
/*
 * W11 (client half) — checkout took orders at a depot that was shut.
 *
 * The screen already knew: `depotOpenState` is computed here and drives the "antar
 * sekarang tidak tersedia" line. Only express was ever withdrawn. Everything else went
 * through — and an order placed at 23:00 sits in CREATED with nobody there to confirm it
 * until `expireAbandoned` auto-cancels it about an hour later (order.service.ts sweeps on
 * the age of the CREATED row, not on the delivery window), with nothing said to the
 * customer who is by then asleep.
 *
 * So the gate is the one already in this file for an address outside every service
 * radius: the submit button goes disabled and a `role="alert"` line beside it says why.
 * Same shape, same two places (the desktop rail and the mobile sticky bar), because the
 * customer only ever sees one of them.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu' }, ready: true }),
}));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: { depotId: 'd-1' } }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/checkout',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import CheckoutPage from '@/app/checkout/page';
import type { DepotHours } from '@/lib/types';

/** SOP hours: Monday 08.00–21.00. 2026-08-10 is a Monday. */
const MON_ONLY: Record<string, DepotHours> = { mon: { open: '08:00', close: '21:00' } };

const depotRow = (operatingHours?: Record<string, DepotHours>) => ({
  id: 'd-1',
  code: 'D1',
  name: 'Depot Satu',
  city: 'Jakarta',
  province: 'DKI',
  lat: -6.2,
  lng: 106.8,
  serviceRadiusKm: 10,
  deliveryFee: 5_000,
  minOrderAmount: null,
  distanceKm: 1,
  withinService: true,
  operatingHours,
  holidays: [],
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

/**
 * No saved address and no map pin, which is the unpinned path: the depot comes from the
 * home location (G3) rather than from a nearby lookup, so the hours under test are the
 * ones on this row.
 */
const serve = (operatingHours?: Record<string, DepotHours>): void => {
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/cart')) return CART;
    if (p.includes('/depots/api/v1/depots?')) {
      return { items: [depotRow(operatingHours)], total: 1, page: 1, limit: 100 };
    }
    if (p.includes('delivery-options')) return { expressEnabled: false, expressFee: 0, slots: [] };
    if (p.includes('/loyalty/')) return { tier: 'REGULAR', discountRate: 0, pointsBalance: 0 };
    if (p.includes('/addresses')) return [];
    return [];
  });
};

/** Both copies of the button: the desktop rail and the mobile sticky bar. */
const submitButtons = () => screen.getAllByRole('button', { name: /Buat pesanan/i });

const draw = async () => {
  render(
    <LocaleProvider>
      <ToastProvider>
        <CheckoutPage />
      </ToastProvider>
    </LocaleProvider>,
  );
  /*
   * Wait for the DEPOT, not for the button. Until the G3 effect has picked the home depot
   * out of `depots.browse`, `needsDepotPick && !pickedDepotId` disables submit on its own
   * — and a test that asserts "disabled" before that lands passes without ever reaching
   * the opening-hours rule. It did: the no-hours case was green before the fix existed.
   */
  await screen.findAllByText(/Depot Satu/);
};

beforeEach(() => {
  // Local wall clock, because that is the clock `depotOpenState` reads.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('W11 — checkout while the depot is shut', () => {
  it('refuses the order at 23:00 and says the depot is closed', async () => {
    vi.setSystemTime(new Date(2026, 7, 10, 23, 0));
    serve(MON_ONLY);
    await draw();

    for (const button of submitButtons()) expect(button).toBeDisabled();
    expect(screen.getAllByRole('alert').some((el) => /tutup/i.test(el.textContent ?? ''))).toBe(true);
  });

  it('takes the order during opening hours', async () => {
    vi.setSystemTime(new Date(2026, 7, 10, 10, 0));
    serve(MON_ONLY);
    await draw();

    for (const button of submitButtons()) expect(button).toBeEnabled();
  });

  it('refuses it at a depot that never configured hours at all', async () => {
    // W11: an unanswered question is not a yes — same rule as `depotOpenState`.
    vi.setSystemTime(new Date(2026, 7, 10, 10, 0));
    serve(undefined);
    await draw();

    for (const button of submitButtons()) expect(button).toBeDisabled();
  });

  it('still takes the order during the midday break — shut for an hour is not shut', async () => {
    vi.setSystemTime(new Date(2026, 7, 10, 12, 30));
    serve({ mon: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' } });
    await draw();

    for (const button of submitButtons()) expect(button).toBeEnabled();
  });
});
