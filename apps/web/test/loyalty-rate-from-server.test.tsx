// @vitest-environment jsdom
/*
 * Three screens stated the earn rate as a literal — "1 poin per Rp 1.000" — while
 * `earnRateRupiah` is a per-depot setting an operator can change:
 *
 *   · the HQ loyalty page, which is the screen an operator reads before going to
 *     Pengaturan to change that very number;
 *   · the customer rewards card ("Cara kerja poin");
 *   · the help FAQ, whose answer is also the text the search box matches on.
 *
 * The settings schema that carries the real value is `@Can('depotAdmin')`, so no customer
 * can read it at all — which is why the two customer screens had nothing to quote but a
 * literal. `GET loyalty/rules` is the public half: the two numbers the program states out
 * loud, and nothing else.
 *
 * A depot on Rp 2.500 is the case that matters: every screen below must say 2.500.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c1', role: 'CUSTOMER' }, ready: true }),
}));

import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

/** Every path the screen under test asked for, so an unread rate can be told from a wrong one. */
let paths: string[] = [];

beforeEach(() => {
  paths = [];
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    paths.push(p);
    // This depot charges Rp 2.500 a point, not the Rp 1.000 the copy used to claim.
    if (p.includes('/loyalty/rules')) return { earnRateRupiah: 2500, pointExpiryMonths: 6 };
    if (p.includes('/loyalty/tiers')) {
      return [{ tier: 'REGULAR', threshold: 0, discountRate: 0 }];
    }
    if (p.includes('/profile') || p.includes('/me')) return { favoriteDepotId: 'depot-1' };
    if (p.includes('/depots/')) return { name: 'Depot Satu', contactPhone: null };
    return [];
  });
  post.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('the earn rate on screen is the earn rate the server is using', () => {
  it('HQ loyalty states the rate it sends the operator to Pengaturan to change', async () => {
    const { default: HqLoyaltyPage } = await import('@/app/hq/loyalty/page');
    render(<HqLoyaltyPage />, { wrapper });
    await waitFor(() => expect(screen.getByText(/2\.500/)).toBeTruthy());
    expect(screen.queryByText(/Rp 1\.000/)).toBeNull();
    // Network-wide: HQ does not quote one depot's override as the program's rule.
    expect(paths.some((p) => p.includes('/loyalty/rules') && p.includes('depotId'))).toBe(false);
  });

  it('the help FAQ answers with this depot rate, and the search box matches it', async () => {
    const { default: HelpPage } = await import('@/app/help/page');
    render(<HelpPage />, { wrapper });
    // Scoped to the reader's own depot, resolved from the profile read already on this page.
    await waitFor(() =>
      expect(paths.some((p) => p.includes('/loyalty/rules') && p.includes('depot-1'))).toBe(true),
    );
    // The answers live in a closed accordion; open the one that quotes the rate.
    await userEvent.click(await screen.findByText(/Apa itu poin/i));
    await waitFor(() => expect(screen.getByText(/2\.500/)).toBeTruthy());
    expect(screen.queryByText(/Rp 1\.000/)).toBeNull();
  });
});
