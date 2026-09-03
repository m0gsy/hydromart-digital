// @vitest-environment jsdom
/**
 * K4.1 — the agen side had no surface at all.
 *
 * No self-registration, no status screen, no notifications. The notifications third turned
 * out to already exist (customer-service sends RESELLER_PRICE_CHANGED /
 * RESELLER_DEACTIVATED through crm, and `http-adapters.spec.ts` covers it), so what was
 * missing was somewhere to answer "am I still an agen, and at what price". The only trace
 * before this was a badge on checkout — which disappeared exactly when the read failed,
 * which is exactly when the price was about to be wrong.
 *
 * The last test is the one that matters beyond this screen: `/resellers/me` is read here
 * for DISPLAY, and A4 deleted the previous caller because checkout used it to re-derive
 * the agen price in the browser. If that import comes back in a pricing file, A4's defect
 * is back with it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/agen',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c1', role: 'CUSTOMER' }, ready: true }),
}));

import AgenPage from '@/app/agen/page';
import { ApiError } from '@/lib/api';
import { LocaleProvider } from '@/lib/locale-context';
import { endpoints } from '@/lib/endpoints';

const DEPOTS = { items: [{ id: 'd1', name: 'Depot Dago', code: 'BDG-01' }] };

function show() {
  render(
    <LocaleProvider>
      <AgenPage />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  getCached.mockReset().mockResolvedValue(DEPOTS);
});
afterEach(() => vi.clearAllMocks());

describe('K4.1 · the agen can see their own terms', () => {
  it('shows the flat gallon price and names the home depot', async () => {
    get.mockResolvedValue({
      active: true,
      discountPct: 0,
      flatGallonPriceIdr: 17000,
      homeDepotId: 'd1',
    });
    show();

    await waitFor(() => expect(screen.getByText(/terdaftar sebagai agen/i)).toBeTruthy());
    // The depot is as load-bearing as the price: agen pricing only applies at that depot,
    // and that is the commonest reason it silently does not appear.
    expect(screen.getByText(/Depot Dago \(BDG-01\)/)).toBeTruthy();
    expect(screen.getByText(/17\.000/)).toBeTruthy();
  });

  it('shows a percentage instead when that is what the depot set', async () => {
    get.mockResolvedValue({
      active: true,
      discountPct: 12,
      flatGallonPriceIdr: 0,
      homeDepotId: 'd1',
    });
    show();

    await waitFor(() => expect(screen.getByText('12%')).toBeTruthy());
    // A flat price of zero must never render as a price — it would read as free.
    expect(screen.queryByText(/Rp\s*0/)).toBeNull();
  });

  it('says so plainly when the agen has been deactivated', async () => {
    get.mockResolvedValue({
      active: false,
      discountPct: 12,
      flatGallonPriceIdr: 0,
      homeDepotId: 'd1',
    });
    show();

    // The heading, not any text: the body repeats the word, and getByText would
    // fail on the duplicate rather than on the behaviour.
    await waitFor(() => expect(screen.getByRole('heading', { name: /nonaktif/i })).toBeTruthy());
    // No price is shown for an inactive agen: it is not the price they will be charged.
    expect(screen.queryByText('12%')).toBeNull();
  });

  it('treats 404 as "not an agen", not as a failure', async () => {
    get.mockRejectedValue(new ApiError(404, 'Not a reseller'));
    show();

    await waitFor(() => expect(screen.getByText(/belum terdaftar sebagai agen/i)).toBeTruthy());
  });

  it('shows an error state for a real failure, so a broken read is never read as "not an agen"', async () => {
    get.mockRejectedValue(new ApiError(500, 'boom'));
    show();

    await waitFor(() => expect(screen.getByText(/tidak bisa dibaca/i)).toBeTruthy());
    expect(screen.queryByText(/belum terdaftar sebagai agen/i)).toBeNull();
  });
});

describe('K4.1 · A4 must not come back', () => {
  it('exposes the self endpoint', () => {
    expect(endpoints.resellers.me).toBe('/customers/api/v1/resellers/me');
  });

  it('is read by the status screen and by nothing that prices an order', async () => {
    const files = import.meta.glob('../src/app/**/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const callers = Object.entries(files as Record<string, string>)
      .filter(([, src]) => src.includes('resellers.me'))
      .map(([f]) => f);

    expect(callers).toEqual([expect.stringContaining('app/agen/page.tsx')]);
    // Named explicitly: these are the files A4 took it out of.
    expect(callers.filter((f) => /checkout|cart/.test(f))).toEqual([]);
  });
});
