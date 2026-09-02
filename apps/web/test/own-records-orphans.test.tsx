// @vitest-environment jsdom
//
// Two routes that answered "what happened to my money / what did I agree to" and had no
// screen. Both are the same shape: the record exists, it is about one person, and that
// person was the one who could not see it.
//
//   GET /payout/api/v1/courier/ledger            the courier's full earnings cash-book
//   GET /auth/api/v1/account/consents/history    every consent decision, oldest first
//
// apps/web is gated at 74/81/50/74, so either screen could have landed with no test and CI
// would have stayed green.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable: the driver screens are behind a staff door and the account screen behind a
// customer one, so one file cannot pin a single role.
const auth = { customer: { id: 'c1', role: 'CUSTOMER', fullName: 'Budi', phone: '81100000001' } };

const { get, getCached, post, put, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { get, getCached, post, put }, ApiError: class extends Error {} }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: auth.customer, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { ConfirmProvider } from '@/components/confirm';
import { LocaleProvider } from '@/lib/locale-context';

/** Every console screen renders inside the app's confirm provider; so must these. */
const Providers = ({ children }: { children: React.ReactNode }) => (
  <ConfirmProvider>
    <LocaleProvider>{children}</LocaleProvider>
  </ConfirmProvider>
);
import DriverEarningsHistoryPage from '@/app/driver/earnings/history/page';
import AccountPage from '@/app/account/page';

afterEach(() => vi.clearAllMocks());

describe('/driver/earnings/history · the courier’s own cash-book', () => {
  const LEDGER = {
    items: [
      {
        id: 'l1',
        courierId: 'k1',
        depotId: 'd1',
        type: 'EARNING',
        amount: 45000,
        description: 'Upah 9 pengiriman',
        sourceRef: null,
        occurredAt: '2026-08-20T03:00:00.000Z',
        createdAt: '2026-08-20T03:00:00.000Z',
      },
      {
        id: 'l2',
        courierId: 'k1',
        depotId: 'd1',
        type: 'CASH_VARIANCE',
        amount: -12000,
        description: 'Selisih setoran 19 Agt',
        sourceRef: 's1',
        occurredAt: '2026-08-19T11:00:00.000Z',
        createdAt: '2026-08-19T11:00:00.000Z',
      },
    ],
    total: 45,
    page: 1,
    limit: 20,
  };

  beforeEach(() => {
    auth.customer = { id: 'k1', role: 'STAFF_DEPOT', fullName: 'Kurir', phone: '81100000003' };
    get.mockReset().mockImplementation((path: string) =>
      String(path).includes('/courier/ledger') ? Promise.resolve(LEDGER) : Promise.resolve({}),
    );
  });

  it('reads the paged ledger, not the summary', async () => {
    render(<DriverEarningsHistoryPage />, { wrapper: Providers });
    expect(await screen.findByText('Upah 9 pengiriman')).toBeTruthy();
    expect(get.mock.calls.some((c) => String(c[0]).includes('/courier/ledger'))).toBe(true);
    expect(get.mock.calls.some((c) => String(c[0]).includes('earnings/summary'))).toBe(false);
  });

  /*
   * The one that matters. A deduction rendered as its absolute value reads exactly like a
   * payment — the courier would see "Rp 12.000" against "Selisih setoran" and take it for
   * money they received.
   */
  it('shows money out as money out', async () => {
    const { container } = render(<DriverEarningsHistoryPage />, { wrapper: Providers });
    await screen.findByText('Selisih setoran 19 Agt');
    const text = container.textContent ?? '';
    expect(text).toContain('−'); // the minus on the deduction
    expect(text).toContain('+'); // and the plus on the earning
  });

  // 45 rows at 20 a page is 3 pages. `Page<T>` carries `total`, not a page count, and
  // reading a `totalPages` that does not exist would render "Hal 1 dari 1" over a history
  // with two more pages in it.
  it('derives the page count from total, not from a field the server never sends', async () => {
    const user = userEvent.setup();
    render(<DriverEarningsHistoryPage />, { wrapper: Providers });
    expect(await screen.findByText('Hal 1 dari 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await waitFor(() =>
      expect(get.mock.calls.some((c) => String(c[0]).includes('page=2'))).toBe(true),
    );
  });

  it('says so when there is nothing, instead of an empty page', async () => {
    get.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    render(<DriverEarningsHistoryPage />, { wrapper: Providers });
    expect(await screen.findByText('Belum ada catatan')).toBeTruthy();
  });
});

describe('/account · consent history (UU PDP)', () => {
  const HISTORY = [
    {
      id: 'h1',
      purpose: 'MARKETING',
      granted: true,
      documentVersion: '2026-01',
      source: 'account-settings',
      recordedAt: '2026-03-01T02:00:00.000Z',
    },
    {
      id: 'h2',
      purpose: 'MARKETING',
      granted: false,
      documentVersion: '2026-01',
      source: 'account-settings',
      recordedAt: '2026-06-01T02:00:00.000Z',
    },
  ];

  beforeEach(() => {
    auth.customer = { id: 'c1', role: 'CUSTOMER', fullName: 'Budi', phone: '81100000001' };
    post.mockReset().mockResolvedValue({});
    put.mockReset().mockResolvedValue({});
    getCached.mockReset().mockResolvedValue([]);
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/consents/history')) return Promise.resolve(HISTORY);
      if (p.includes('/consents')) return Promise.resolve([]);
      if (p.includes('/loyalty/me')) return Promise.resolve({ pointsBalance: 0, lifetimePoints: 0, tier: 'BRONZE' });
      return Promise.resolve([]);
    });
  });

  it('is collapsed until asked for, then shows every decision with its date', async () => {
    const user = userEvent.setup();
    render(<AccountPage />, { wrapper: Providers });
    await user.click(await screen.findByText('Persetujuan data'));

    // Collapsed: the current state is what somebody opens this sheet for.
    expect(screen.queryByText('Riwayat persetujuan')).toBeNull();

    await user.click(await screen.findByRole('button', { name: 'Lihat riwayat' }));
    expect(await screen.findByText('Riwayat persetujuan')).toBeTruthy();
    // Both decisions, and which way each one went — a history that showed only the current
    // state would answer the question the toggles already answer.
    expect(await screen.findByText('Disetujui')).toBeTruthy();
    expect(await screen.findByText('Ditarik')).toBeTruthy();
  });
});
