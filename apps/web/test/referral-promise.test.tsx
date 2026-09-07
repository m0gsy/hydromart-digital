// @vitest-environment jsdom
/*
 * CA-3-45 — two screens promised a referral reward the program does not pay.
 *
 *   · /referral said the friend gets "potongan di pesanan pertama". Nothing in the
 *     codebase grants a discount for a referral: `ReferralService.qualify` awards POINTS
 *     to both sides, and only once the friend's first order completes.
 *   · /rewards said "+50 poin", against a setting that has paid 500 since it existed.
 *
 * Both numbers are settings (`referrerPoints`, `refereePoints`), so the fix is the one
 * `loyalty-rate-from-server.test.tsx` already holds for the earn rate: the screen states
 * what the server is paying. A depot on 750/400 is the case that matters — every screen
 * below must say those numbers and neither of the old literals.
 */
import { render, screen, waitFor } from '@testing-library/react';
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
  useAuth: () => ({ customer: { id: 'c1', role: 'CUSTOMER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/cart-context', () => ({
  useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }),
}));
// /rewards reads the depot being shopped from; the real provider is not mounted here.
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({
    location: { label: 'Ciputat', lat: -6.3, lng: 106.7, depotId: 'depot-1' },
    ready: true,
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

beforeEach(() => {
  // Fixture shapes matter here: half these endpoints answer `{items,total}` and half a
  // bare array, and a wrong one makes the component throw before any assertion is reached.
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    // This network pays 750 / 400, not the 500 / 250 defaults and certainly not "+50".
    if (p.includes('/referrals/rules')) return { referrerPoints: 750, refereePoints: 400 };
    if (p.includes('/referrals/me')) {
      return {
        code: { code: 'ABCD1234' },
        referredCount: 2,
        qualifiedCount: 1,
        pointsEarned: 750,
      };
    }
    if (p.includes('/vouchers/')) return [];
    if (p.includes('/loyalty/rules')) return { earnRateRupiah: 1000, pointExpiryMonths: 12 };
    if (p.includes('/loyalty/me/transactions')) return { items: [], total: 0 };
    if (p.includes('/loyalty/me')) {
      return { pointsBalance: 900, lifetimePoints: 900, tier: 'SILVER', discountRate: 0.02 };
    }
    if (p.includes('/loyalty/tiers')) return [];
    if (p.includes('/rewards/redemptions/me')) return [];
    if (p.includes('/rewards/catalog')) return [];
    if (p.includes('/depots')) return { items: [], total: 0 };
    if (p.includes('gallon-deposit')) return [];
    if (p.includes('/customers/me') || p.includes('/profile')) return { favoriteDepotId: 'depot-1' };
    return [];
  });
  post.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('the referral reward on screen is the reward the server pays', () => {
  it('/referral names points and both amounts, and promises no discount', async () => {
    const { default: ReferralPage } = await import('@/app/referral/page');
    render(<ReferralPage />, { wrapper });

    const hint = await screen.findByText(/750 poin/);
    expect(hint.textContent).toMatch(/400 poin/);
    // The defect itself: a discount for the friend that nothing anywhere grants.
    expect(hint.textContent).not.toMatch(/potongan di pesanan pertama/i);
    // And it says WHEN, because qualification rides the friend's first completed order.
    expect(hint.textContent).toMatch(/pesanan pertama temanmu selesai/i);
  });

  it('/rewards quotes the friend bonus the server pays, not "+50"', async () => {
    const { default: RewardsPage } = await import('@/app/rewards/page');
    render(<RewardsPage />, { wrapper });

    await waitFor(() => expect(screen.getByText(/\+400 poin/)).toBeTruthy());
    expect(screen.queryByText(/\+50 poin/)).toBeNull();
  });
});
