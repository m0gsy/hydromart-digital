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
import { fireEvent, render, screen } from '@testing-library/react';
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
const serve = (
  operatingHours?: Record<string, DepotHours>,
  deliveryOptions: { expressEnabled: boolean; expressFee: number; slots: unknown[] } = {
    expressEnabled: false,
    expressFee: 0,
    slots: [],
  },
): void => {
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/cart')) return CART;
    if (p.includes('/depots/api/v1/depots?')) {
      return { items: [depotRow(operatingHours)], total: 1, page: 1, limit: 100 };
    }
    if (p.includes('delivery-options')) return deliveryOptions;
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

/*
 * A WIB wall clock, built as an explicit instant.
 *
 * `depotOpenState` reads the DEPOT's timezone, not the machine's, so `new Date(y, m, d, h)`
 * — which builds the instant in whatever zone the runner happens to be in — asserts the
 * author's timezone rather than the opening hours. Asia/Jakarta is UTC+7 all year.
 */
const wib = (y: number, m: number, d: number, hh: number, mm = 0): Date =>
  new Date(Date.UTC(y, m - 1, d, hh - 7, mm));

describe('a shut depot withdraws EXPRESS; it does not refuse the order', () => {
  /*
   * The contract, and all three places the repo already stated it:
   *
   *   opening-hours.ts:5    "Deliberately NOT used to block scheduled orders: a customer
   *                          may order at 22:00 for tomorrow morning."
   *   order.service.ts:437   if (input.express && !expressAvailable) throw ...  ← express only
   *   order.prisma.repository.ts (W2b) gives a windowed order four days of grace, precisely
   *                          so the 22:00-for-tomorrow order survives the sweep.
   *
   * The first cut of this gate disabled submit for EVERYTHING, and the tests here pinned
   * that — which is why CI stayed green over it. They never separated express from
   * scheduled, so the one distinction the rule is about was the one thing untested.
   *
   * Cost while it was live: both production depots open 08:00-21:00, so checkout refused
   * money 11 hours a day at every depot, for orders the server accepted without complaint.
   */
  it('takes a scheduled order at 23:00 — the depot is shut, the delivery is for tomorrow', async () => {
    vi.setSystemTime(wib(2026, 8, 10, 23, 0));
    serve(MON_ONLY);
    await draw();

    for (const button of submitButtons()) expect(button).toBeEnabled();
  });

  it('and still says the depot is closed, because informing is not refusing', async () => {
    vi.setSystemTime(wib(2026, 8, 10, 23, 0));
    serve(MON_ONLY);
    await draw();

    expect(screen.getAllByText(/tutup/i).length).toBeGreaterThan(0);
  });

  it('refuses an EXPRESS order while the depot is shut', async () => {
    /*
     * Belt and braces: the server withdraws express itself (`deliveryOptions` applies the
     * same test), so in production `expressEnabled` would already be false here. This forces
     * it true to exercise the client gate on its own — the one case where the screen SHOULD
     * be strict, and the only one.
     */
    vi.setSystemTime(wib(2026, 8, 10, 23, 0));
    serve(MON_ONLY, { expressEnabled: true, expressFee: 5_000, slots: [] });
    await draw();

    for (const button of submitButtons()) expect(button).toBeEnabled();
    // The window options live behind their own sheet, so it has to be opened first —
    // the same two taps a customer makes.
    fireEvent.click(screen.getByRole('button', { name: /waktu pengiriman/i }));
    fireEvent.click(await screen.findByText('Antar sekarang'));
    for (const button of submitButtons()) expect(button).toBeDisabled();
  });

  it('takes the order during opening hours', async () => {
    vi.setSystemTime(wib(2026, 8, 10, 10, 0));
    serve(MON_ONLY);
    await draw();

    for (const button of submitButtons()) expect(button).toBeEnabled();
  });

  it('takes a scheduled order at a depot that never configured hours', async () => {
    /*
     * W11 made an absent `operatingHours` read as SHUT rather than always-open, and that is
     * right: an unanswered question is not a yes, and express must not be offered. But shut
     * still does not mean "refuse the money" — this is the DEMO-01 shape, and a customer
     * scheduling for tomorrow is exactly who the four-day window is for.
     */
    vi.setSystemTime(wib(2026, 8, 10, 10, 0));
    serve(undefined);
    await draw();

    for (const button of submitButtons()) expect(button).toBeEnabled();
  });

  it('still takes the order during the midday break — shut for an hour is not shut', async () => {
    vi.setSystemTime(wib(2026, 8, 10, 12, 30));
    serve({ mon: { open: '08:00', close: '21:00', breakStart: '12:00', breakEnd: '13:00' } });
    await draw();

    for (const button of submitButtons()) expect(button).toBeEnabled();
  });
});
