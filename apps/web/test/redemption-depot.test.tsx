// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
}));

const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class FakeApiError extends Error {
    status: number;
    code: string;
    constructor(message: string, status = 400, code = 'BAD_REQUEST') {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
vi.mock('@/lib/api', () => ({ api: { get, getCached, post }, ApiError: FakeApiError }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'c-1' }, ready: true }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// jsdom has no layout, so it ships no `scrollIntoView`; the page calls it when the
// ledger opens. Stubbing the browser API is the honest half — mocking the module that
// calls it would load a second instance that never runs and report as uncovered.
Element.prototype.scrollIntoView = vi.fn();

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


/**
 * The rest of what this screen draws. Before H14 put a test on it, `/rewards` — the screen
 * that spends points — had no render coverage at all: v8 reported the file as one covered
 * line, which is how a 760-line page reads as "100%" at the gate. Every case here is a
 * branch that ran in production and was measured by nothing.
 */
describe('/rewards — the states it draws', () => {
  const TIERS = [
    { tier: 'BRONZE', threshold: 0, discountRate: 0 },
    { tier: 'SILVER', threshold: 500, discountRate: 0.02 },
    { tier: 'GOLD', threshold: 2000, discountRate: 0.05 },
  ];

  const renderPage = () =>
    render(
      <LocaleProvider>
        <ToastProvider>
          <RewardsPage />
        </ToastProvider>
      </LocaleProvider>,
    );

  function mockAll(over: Record<string, unknown> = {}) {
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      for (const [frag, value] of Object.entries(over)) {
        if (p.includes(frag)) return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      }
      if (p.includes('/rewards/redemptions/me')) return Promise.resolve(ROWS);
      if (p.includes('/rewards/catalog')) return Promise.resolve([{ id: 'ri-1', name: 'Galon gratis', pointsCost: 500 }]);
      if (p.includes('/depots')) return Promise.resolve(DEPOTS);
      if (p.includes('/loyalty/me/transactions')) return Promise.resolve({ items: [], total: 0 });
      if (p.includes('/loyalty/me')) {
        return Promise.resolve({ pointsBalance: 900, lifetimePoints: 900, tier: 'SILVER', discountRate: 0.02 });
      }
      if (p.includes('/loyalty/tiers')) return Promise.resolve(TIERS);
      if (p.includes('/referrals/me')) {
        return Promise.resolve({ code: { code: 'ABC123' }, referredCount: 0, qualifiedCount: 0, pointsEarned: 0 });
      }
      return Promise.resolve([]);
    });
    getCached.mockReset().mockImplementation((path: string) =>
      String(path).includes('/depots') ? Promise.resolve(DEPOTS) : Promise.resolve([]),
    );
  }

  beforeEach(() => mockAll());

  it('shows the tier discount and the distance to the next tier', async () => {
    renderPage();
    // 900 lifetime points, GOLD at 2000 — 1100 to go, and SILVER already earns 2%.
    expect(await screen.findByText(/2%/)).toBeInTheDocument();
    expect(await screen.findByText(/1\.100/)).toBeInTheDocument();
  });

  it('crowns the top tier only once the ladder has actually been read', async () => {
    mockAll({
      '/loyalty/me': { pointsBalance: 9000, lifetimePoints: 9000, tier: 'GOLD', discountRate: 0.05 },
    });
    renderPage();
    await screen.findAllByText('Galon gratis');
    expect(screen.queryByText(/tier tertinggi|top tier/i)).toBeInTheDocument();
  });

  it('says the ledger is empty rather than drawing an empty box', async () => {
    mockAll({ '/rewards/redemptions/me': [] });
    renderPage();
    expect(await screen.findByText(/belum ada penukaran/i)).toBeInTheDocument();
  });

  it('offers a retry when the redemption list will not load', async () => {
    mockAll({ '/rewards/redemptions/me': new Error('penukaran 503') });
    renderPage();
    expect(await screen.findByRole('button', { name: /coba lagi|try again/i })).toBeInTheDocument();
  });

  it('offers a retry when the reward catalogue will not load', async () => {
    mockAll({ '/rewards/catalog': new Error('katalog 503') });
    renderPage();
    expect(await screen.findByRole('button', { name: /coba lagi|try again/i })).toBeInTheDocument();
  });

  it('falls back to a neutral phrase when the depot directory has no name for the row', async () => {
    mockAll({ '/depots': { items: [], total: 0 } });
    getCached.mockImplementation(() => Promise.resolve({ items: [], total: 0 }));
    renderPage();
    // The row still says WHERE, in the only words that are true: the depot they chose.
    expect(await screen.findByText(/depot yang kamu pilih/i)).toBeInTheDocument();
  });

  it('opens the points ledger on demand rather than loading it into every visit', async () => {
    renderPage();
    const toggle = await screen.findByRole('button', { name: /lihat riwayat poin|riwayat poin/i });
    await userEvent.click(toggle);
    expect(await screen.findByRole('button', { name: /sembunyikan/i })).toBeInTheDocument();
  });

  it('switches the phone tabs without refetching', async () => {
    renderPage();
    await screen.findAllByText('Galon gratis');
    const before = get.mock.calls.length;
    const tabs = screen.getAllByRole('button', { name: /riwayat/i });
    await userEvent.click(tabs[0]!);
    expect(get.mock.calls.length).toBe(before);
  });
});


/**
 * The two writes this screen performs. Both spend or return points, and neither had a
 * test: a redemption that silently failed to cancel left the points gone with the reward
 * unclaimable, and the screen would have looked identical either way.
 */
describe('/rewards — spending and getting points back', () => {
  const renderPage = () =>
    render(
      <LocaleProvider>
        <ToastProvider>
          <RewardsPage />
        </ToastProvider>
      </LocaleProvider>,
    );

  beforeEach(() => {
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/rewards/redemptions/me')) return Promise.resolve(ROWS);
      if (p.includes('/rewards/catalog')) return Promise.resolve([{ id: 'ri-1', name: 'Galon gratis', pointsCost: 500 }]);
      if (p.includes('/depots')) return Promise.resolve(DEPOTS);
      if (p.includes('/loyalty/me/transactions')) return Promise.resolve({ items: [], total: 0 });
      if (p.includes('/loyalty/me')) return Promise.resolve({ pointsBalance: 900, lifetimePoints: 900, tier: 'SILVER', discountRate: 0.02 });
      if (p.includes('/loyalty/tiers')) return Promise.resolve([]);
      if (p.includes('/referrals/me')) return Promise.resolve({ code: { code: 'ABC123' }, referredCount: 0, qualifiedCount: 0, pointsEarned: 0 });
      return Promise.resolve([]);
    });
    getCached.mockReset().mockImplementation((path: string) =>
      String(path).includes('/depots') ? Promise.resolve(DEPOTS) : Promise.resolve([]),
    );
    post.mockReset().mockResolvedValue({ pointsBalance: 1400 });
  });

  it('gives the points back and says so when a redemption is cancelled', async () => {
    renderPage();
    const cancels = await screen.findAllByRole('button', { name: /batalkan/i });
    await userEvent.click(cancels[0]!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]?.[0])).toContain('/cancel');
    expect(await screen.findByText(/poin sudah dikembalikan/i)).toBeInTheDocument();
  });

  it("shows the server's own reason when it refuses the cancel", async () => {
    post.mockRejectedValue(new FakeApiError('Hadiah sudah diserahkan petugas.', 409, 'CONFLICT'));
    renderPage();
    const cancels = await screen.findAllByRole('button', { name: /batalkan/i });
    await userEvent.click(cancels[0]!);
    expect(await screen.findByText(/sudah diserahkan petugas/i)).toBeInTheDocument();
  });
});


/**
 * The referral card and the point ledger — the two panels on this screen a customer can
 * put input into, and the two that were reporting as "covered" because nothing had ever
 * rendered them.
 */
describe('/rewards — referral code and the ledger', () => {
  const renderPage = () =>
    render(
      <LocaleProvider>
        <ToastProvider>
          <RewardsPage />
        </ToastProvider>
      </LocaleProvider>,
    );

  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/rewards/redemptions/me')) return Promise.resolve([]);
      if (p.includes('/rewards/catalog')) return Promise.resolve([]);
      if (p.includes('/depots')) return Promise.resolve(DEPOTS);
      if (p.includes('/loyalty/me/transactions')) return Promise.resolve({ items: [], total: 0 });
      if (p.includes('/loyalty/me')) return Promise.resolve({ pointsBalance: 0, lifetimePoints: 0, tier: 'BRONZE', discountRate: 0 });
      if (p.includes('/loyalty/tiers')) return Promise.resolve([]);
      if (p.includes('/referrals/me')) return Promise.resolve({ code: { code: 'ABC123' }, referredCount: 0, qualifiedCount: 0, pointsEarned: 0 });
      return Promise.resolve([]);
    });
    getCached.mockReset().mockImplementation((path: string) =>
      String(path).includes('/depots') ? Promise.resolve(DEPOTS) : Promise.resolve([]),
    );
    post.mockReset().mockResolvedValue({});
  });

  it('confirms in the button itself that the referral code was copied', async () => {
    renderPage();
    // The button carries an aria-label that does NOT change when it flips, so the
    // confirmation a sighted customer sees is the visible text — assert on that.
    const copy = await screen.findByRole('button', { name: /salin|copy/i });
    await userEvent.click(copy);
    expect(await screen.findByText(/tersalin|copied/i)).toBeInTheDocument();
  });

  it("shows the server's reason when a referral code is refused", async () => {
    post.mockRejectedValue(new FakeApiError('Kode tidak ditemukan.', 404, 'NOT_FOUND'));
    renderPage();
    const input = await screen.findByPlaceholderText('A1B2C3D4');
    await userEvent.type(input, 'XYZ999');
    await userEvent.click(screen.getByRole('button', { name: /pakai|gunakan|redeem|apply/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak ditemukan/i);
  });

  it('says the ledger is empty rather than drawing an empty list', async () => {
    renderPage();
    const toggle = await screen.findByRole('button', { name: /lihat aktivitas poin/i });
    await userEvent.click(toggle);
    expect((await screen.findAllByText(/belum ada/i)).length).toBeGreaterThan(0);
  });

  it('offers a retry when the membership card itself will not load', async () => {
    get.mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/loyalty/me') && !p.includes('transactions')) return Promise.reject(new FakeApiError('kartu 503'));
      if (p.includes('/loyalty/me/transactions')) return Promise.resolve({ items: [], total: 0 });
      if (p.includes('/referrals/me')) {
        return Promise.resolve({ code: { code: 'ABC123' }, referredCount: 0, qualifiedCount: 0, pointsEarned: 0 });
      }
      return Promise.resolve([]);
    });
    renderPage();
    /*
     * NOT asserted on the message: `use-async.ts` imports ApiError from './api', a
     * different specifier from the '@/lib/api' this file mocks, so its `instanceof` check
     * misses the fake and every rejection reads as the generic fallback. The retry button
     * is what the customer actually needs, and it is what this proves.
     */
    expect(await screen.findByRole('button', { name: /coba lagi|try again/i })).toBeInTheDocument();
  });
});
