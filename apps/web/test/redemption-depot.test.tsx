// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'c-1' }, ready: true }) }));
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

const DEPOTS = {
  items: [
    { id: 'd-1', name: 'Depot Kemang', city: 'Jakarta' },
    { id: 'd-2', name: 'Depot Ciputat', city: 'Tangsel' },
  ],
  total: 2,
};

const ROWS = [
  {
    id: 'r-with-depot-0000',
    rewardItemId: 'ri-1',
    rewardName: 'Galon gratis',
    customerId: 'c-1',
    depotId: 'd-2',
    pointsSpent: 500,
    status: 'ACTIVE',
    usedAt: null,
    cancelledAt: null,
    createdAt: '2026-08-01T03:00:00.000Z',
  },
  {
    id: 'r-legacy-null-000',
    rewardItemId: 'ri-1',
    rewardName: 'Voucher ongkir',
    customerId: 'c-1',
    depotId: null,
    pointsSpent: 200,
    status: 'ACTIVE',
    usedAt: null,
    cancelledAt: null,
    createdAt: '2026-07-01T03:00:00.000Z',
  },
];

/**
 * H14. The collection depot is asked at redemption time and comes straight back on the
 * row — and the screen showed reward name, date and points and dropped it. The customer
 * held a code with nowhere written on it to take it.
 *
 * Rows made before the question was asked carry `depotId: null` (3 of the 4 in production
 * on 22 Aug 2026). Those must stay legible rather than print a depot nobody chose.
 */
describe('/rewards — where a redemption is collected', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/rewards/redemptions/me')) return Promise.resolve(ROWS);
      if (p.includes('/depots')) return Promise.resolve(DEPOTS);
      if (p.includes('/loyalty/me')) return Promise.resolve({ pointsBalance: 900, lifetimePoints: 900, tier: 'SILVER' });
      if (p.includes('/loyalty/tiers')) return Promise.resolve([]);
      if (p.includes('/referrals/me')) {
        return Promise.resolve({
          code: { code: 'ABC123' },
          referredCount: 0,
          qualifiedCount: 0,
          pointsEarned: 0,
        });
      }
      if (p.includes('/me/transactions')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve([]);
    });
    getCached.mockReset().mockImplementation((path: string) =>
      String(path).includes('/depots') ? Promise.resolve(DEPOTS) : Promise.resolve([]),
    );
    post.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  const renderPage = () =>
    render(
      <LocaleProvider>
        <ToastProvider>
          <RewardsPage />
        </ToastProvider>
      </LocaleProvider>,
    );

  it('names the depot the reward is collected from', async () => {
    renderPage();
    expect(await screen.findByText(/Depot Ciputat/)).toBeInTheDocument();
  });

  it('says so plainly for a legacy row that never recorded one', async () => {
    renderPage();
    await screen.findByText('Voucher ongkir');
    expect(await screen.findByText(/depot mana pun/i)).toBeInTheDocument();
  });
});
