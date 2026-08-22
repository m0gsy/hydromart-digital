// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
}));

const state = { depotId: 'd-2' as string | undefined };

vi.mock('@/lib/api', () => ({ api: { get, getCached, post }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu', phone: '0811' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }) }));
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: { label: 'Ciputat', lat: -6.3, lng: 106.7, depotId: state.depotId }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/rewards',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import RewardsPage from '@/app/rewards/page';
import AccountPage from '@/app/account/page';

function mockApi() {
  const impl = (path: string) => {
    const p = String(path);
    if (p.includes('/rewards/redemptions/me')) return Promise.resolve([]);
    if (p.includes('/rewards/catalog')) return Promise.resolve([]);
    if (p.includes('/depots')) return Promise.resolve({ items: [], total: 0 });
    if (p.includes('/loyalty/me/transactions')) return Promise.resolve({ items: [], total: 0 });
    if (p.includes('/loyalty/me')) {
      return Promise.resolve({ pointsBalance: 900, lifetimePoints: 900, tier: 'SILVER', discountRate: 0.02 });
    }
    if (p.includes('/loyalty/tiers')) return Promise.resolve([]);
    if (p.includes('/referrals/me')) {
      return Promise.resolve({ code: { code: 'ABC123' }, referredCount: 0, qualifiedCount: 0, pointsEarned: 0 });
    }
    if (p.includes('gallon-deposit')) return Promise.resolve([]);
    return Promise.resolve([]);
  };
  get.mockReset().mockImplementation(impl);
  getCached.mockReset().mockImplementation(impl);
}

const loyaltyPaths = () =>
  [...get.mock.calls, ...getCached.mock.calls]
    .map((c) => String(c[0]))
    .filter((p) => /\/loyalty\/(me|tiers)(\?|$)/.test(p));

beforeEach(() => {
  state.depotId = 'd-2';
  mockApi();
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

/**
 * H15. One account, two answers. The home teaser reads loyalty scoped to the shopper's
 * depot (`loyalty.me(depotId)`); /rewards and /account read it unscoped. The points are
 * never different — loyalty-service keeps one balance per customer, deliberately — but the
 * TIER and the DISCOUNT RATE are re-derived against the depot's own ladder, so the same
 * account can read GOLD on the home screen and SILVER two taps later, promising two
 * different percentages in one session.
 *
 * Measured in production on 22 Aug 2026: every `*DiscountPct` setting, GLOBAL and DEPOT
 * alike, is 0, and no depot overrides a threshold — so the divergence today is ZERO. This
 * is a latent contradiction, not a live one, and it goes live the moment a depot sets its
 * own rate. Fixed now, while it costs nothing to fix.
 *
 * The chosen truth: whatever the customer will actually be charged at the depot they are
 * shopping from. That is already the reason written on the home teaser — "a teaser
 * promising a rate the local depot does not give is worse than no teaser" — and a rewards
 * screen quoting a rate the checkout will not honour is the same fault, one screen along.
 */
describe('H15 — one account, one loyalty scope', () => {
  const renderRewards = () =>
    render(
      <LocaleProvider>
        <ToastProvider>
          <RewardsPage />
        </ToastProvider>
      </LocaleProvider>,
    );

  it('/rewards asks for the standing at the depot being shopped from', async () => {
    renderRewards();
    await waitFor(() => expect(loyaltyPaths().length).toBeGreaterThan(0));
    for (const p of loyaltyPaths()) expect(p).toContain('depotId=d-2');
  });

  it('/account asks for the same one', async () => {
    render(<AccountPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(loyaltyPaths().length).toBeGreaterThan(0));
    for (const p of loyaltyPaths()) expect(p).toContain('depotId=d-2');
  });

  it('falls back to the network-wide ladder when no depot is known yet', async () => {
    state.depotId = undefined;
    renderRewards();
    await waitFor(() => expect(loyaltyPaths().length).toBeGreaterThan(0));
    for (const p of loyaltyPaths()) expect(p).not.toContain('depotId=');
  });
});
