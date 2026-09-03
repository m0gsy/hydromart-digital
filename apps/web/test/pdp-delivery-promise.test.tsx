// @vitest-environment jsdom
/*
 * CA-3-16 / CA-3-18 / CA-3-19 — three screens that promised what nobody had checked.
 *
 * `depots.nearby` answers with the NEAREST depot. Nearest is not "serves this address" and
 * it is not "open": the product page printed "Dikirim dari X", a green Buka chip and
 * "tiba hari ini" over a depot 40 km outside its own radius at eleven at night. Both facts
 * — `withinService` and the configured hours — travel on the very row the page already had.
 *
 * The home strip had the same shape without even a row to blame: "COD / QRIS / e-wallet"
 * was a string constant. E-wallet is not a method this platform accepts, and QRIS is the
 * depot's own printed code, which most depots have never uploaded.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: null, ready: true }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: { lat: -6.2, lng: 106.8, depotId: 'd-1' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/products/detail',
  useSearchParams: () => new URLSearchParams('id=p-1'),
}));

import { LocaleProvider } from '@/lib/locale-context';
import ProductDetailPage from '@/app/products/detail/page';
import { NearbyDepots } from '@/components/nearby-depots';

const PRODUCT = {
  id: 'p-1',
  name: 'Galon 19L',
  sku: 'AIR-19L',
  unit: 'Galon',
  basePrice: 20_000,
  imageUrl: null,
  isActive: true,
  isGallon: true,
};

/** Monday 08:00–21:00. The tests pin the clock either inside or outside that. */
const MON = { mon: { open: '08:00', close: '21:00' } };

const depot = (over: Record<string, unknown> = {}) => ({
  id: 'd-1',
  code: 'D1',
  name: 'Depot Satu',
  address: 'Jl. Satu',
  city: 'Jakarta',
  province: 'DKI',
  lat: -6.2,
  lng: 106.8,
  serviceRadiusKm: 10,
  deliveryFee: 5_000,
  minOrderAmount: null,
  distanceKm: 2,
  withinService: true,
  operatingHours: MON,
  holidays: [],
  ...over,
});

const serve = (rows: unknown[]) => {
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/depots/api/v1/depots/nearby')) return rows;
    if (p.includes('/products/api/v1/products/p-1')) return PRODUCT;
    if (p.includes('shelf-prices')) return { basis: 'CATALOG', prices: [] };
    if (p.includes('/categories')) return [];
    return [];
  });
};

/** 2026-08-10 is a Monday. 10:00 WIB is inside the window, 23:00 outside it. */
const atWib = (hhmm: string) => new Date(`2026-08-10T${hhmm}:00+07:00`);

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the product page stops promising what it never checked', () => {
  it('says the depot does not deliver here, instead of "dikirim dari"', async () => {
    vi.setSystemTime(atWib('10:00'));
    serve([depot({ withinService: false, distanceKm: 41.2 })]);

    render(<ProductDetailPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/belum mengantar ke alamat ini/i)).toBeTruthy();
    expect(screen.queryByText(/tiba hari ini/i)).toBeNull();
  });

  it('says the depot is shut instead of showing a green Buka chip', async () => {
    vi.setSystemTime(atWib('23:00'));
    serve([depot()]);

    render(<ProductDetailPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/^Tutup$/)).toBeTruthy();
    expect(screen.queryByText(/tiba hari ini/i)).toBeNull();
  });

  it('still promises same-day when the depot is open and does serve the address', async () => {
    vi.setSystemTime(atWib('10:00'));
    serve([depot()]);

    render(<ProductDetailPage />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/tiba hari ini/i)).toBeTruthy();
    expect(screen.getByText(/^Buka$/)).toBeTruthy();
  });
});

describe('the home strip names payment methods that exist (CA-3-19)', () => {
  it('drops e-wallet, and QRIS at a depot that has no QRIS code', async () => {
    vi.setSystemTime(atWib('10:00'));
    serve([depot({ acceptsQris: false, acceptsTransfer: false })]);

    render(<NearbyDepots />, { wrapper: LocaleProvider });

    // Cash is never filtered, so there is always a way left to pay.
    expect(await screen.findByText(/Tunai|COD/i)).toBeTruthy();
    expect(screen.queryByText(/e-wallet/i)).toBeNull();
    expect(screen.queryByText(/QRIS/i)).toBeNull();
  });

  it('names QRIS at a depot that actually accepts it', async () => {
    vi.setSystemTime(atWib('10:00'));
    serve([depot({ acceptsQris: true, acceptsTransfer: false })]);

    render(<NearbyDepots />, { wrapper: LocaleProvider });

    expect(await screen.findByText(/QRIS/)).toBeTruthy();
    expect(screen.queryByText(/e-wallet/i)).toBeNull();
  });
});
