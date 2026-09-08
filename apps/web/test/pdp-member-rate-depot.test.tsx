// @vitest-environment jsdom
/*
 * CA-3-15 — the member-discount note on the product page read the GLOBAL rate.
 *
 * Tier thresholds and member rates are per-depot settings. This page draws its amber
 * "as a SILVER member you save N%" note from `loyalty/me`, and it was the only one of the
 * seven `loyalty.me` callers in the app that sent no depot — so it answered against the
 * global ladder while the price beside it came from `cartDepotId()`. Whenever a depot
 * overrode the rate, the note and the price on one screen disagreed, and the note was the
 * one that was wrong.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER' }, ready: true }),
}));
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

beforeEach(() => {
  get.mockReset().mockImplementation(async (url: string) => {
    if (url.includes('/products/api/v1/products/p-1')) return PRODUCT;
    if (url.includes('/loyalty/me')) return { tier: 'SILVER', points: 0 };
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

const loyaltyCalls = () =>
  get.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/loyalty/api/v1/loyalty/me'));

describe('CA-3-15 the product page asks about the depot that will bill', () => {
  it('scopes the member read to the chosen depot', async () => {
    render(<ProductDetailPage />, { wrapper: LocaleProvider });
    await vi.waitFor(() => expect(loyaltyCalls().length).toBeGreaterThan(0));
    // Not merely "a depot was sent" — the one the cart and the price already use.
    expect(loyaltyCalls().every((u) => u.includes('depotId=d-1'))).toBe(true);
  });

  it('never asks the global ladder while a depot is chosen', async () => {
    render(<ProductDetailPage />, { wrapper: LocaleProvider });
    await vi.waitFor(() => expect(loyaltyCalls().length).toBeGreaterThan(0));
    // The unscoped URL is the bug: `loyalty/me` with no query answers globally.
    expect(loyaltyCalls().some((u) => !u.includes('depotId='))).toBe(false);
  });
});
