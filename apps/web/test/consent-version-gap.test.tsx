// @vitest-environment jsdom
//
// W10. Two routes auth-service built to close the "the wording moved and nobody could tell"
// hole, both of which landed with no screen — the same hole, one step along:
//
//   GET /auth/api/v1/account/consents/pending   the account's own answer (role CUSTOMER)
//   GET /auth/api/v1/account/consents/report    the fleet-wide one (capability pdpRequests)
//
// The four things that can go wrong here are not rendering bugs, they are honesty bugs:
//
//   1. `enforcement: 'UNENFORCED'` means the SERVER does nothing about the answer. A UI
//      that blocks would enforce a rule that does not exist, and be a harder wall than any
//      the product has.
//   2. ...and saying nothing is the other failure. "UNENFORCED not silent" — the gap gets
//      said on the screen, not left to be inferred from the absence of a blocker.
//   3. The report's totals overlap. Only `current` is exclusive, so anything that presents
//      them as parts of a whole (a pie, a stacked bar, "the rest are fine") is wrong.
//   4. "Never asked" is not "refused", and nearly the entire base reads `outdated` on day
//      one because the ledger migration backfilled every row at '1.0'.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, put, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, put },
  ApiError: class extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'c1', role: 'CUSTOMER', fullName: 'Budi', phone: '81100000001' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/cart-context', () => ({
  useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }),
}));
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
import AccountPage from '@/app/account/page';
import HqPdpPage from '@/app/hq/pdp/page';

const CONSENTS = [
  {
    purpose: 'TERMS',
    granted: true,
    mandatory: true,
    withdrawable: false,
    decidedAt: '2026-01-02T00:00:00.000Z',
    documentVersion: '1.0',
  },
  {
    purpose: 'PRIVACY',
    granted: true,
    mandatory: true,
    withdrawable: false,
    decidedAt: '2026-01-02T00:00:00.000Z',
    documentVersion: '1.0',
  },
  {
    purpose: 'MARKETING',
    granted: false,
    mandatory: false,
    withdrawable: true,
    decidedAt: '2026-01-02T00:00:00.000Z',
    documentVersion: '1.0',
  },
];

afterEach(() => vi.clearAllMocks());

describe('/account · "the text you agreed to has been replaced"', () => {
  function mockAccount(pending: unknown) {
    post.mockReset().mockResolvedValue({});
    put.mockReset().mockResolvedValue({});
    getCached.mockReset().mockResolvedValue([]);
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      // Checked BEFORE '/consents': every one of these paths contains it.
      if (p.includes('/consents/pending')) return Promise.resolve(pending);
      if (p.includes('/consents/history')) return Promise.resolve([]);
      if (p.includes('/consents')) return Promise.resolve(CONSENTS);
      if (p.includes('/loyalty/me'))
        return Promise.resolve({ pointsBalance: 0, lifetimePoints: 0, tier: 'BRONZE' });
      return Promise.resolve([]);
    });
  }

  const OWED = {
    documentVersion: '2026-08-29',
    purposes: ['TERMS', 'PRIVACY'],
    mustAccept: true,
    enforcement: 'UNENFORCED',
  };

  it('says the wording moved, names the version, and links to both documents', async () => {
    mockAccount(OWED);
    const user = userEvent.setup();
    render(<AccountPage />, { wrapper: Providers });
    await user.click(await screen.findByText('Persetujuan data'));

    expect(await screen.findByText('Syarat & kebijakan sudah diperbarui')).toBeTruthy();
    // The version in force, not "a new version" — a notice that cannot be checked against
    // the document it points at is a notice nobody can act on.
    expect(
      screen.getByText((s) => s.includes('2026-08-29') && s.includes('versi')),
    ).toBeTruthy();
    // The sheet renders through a Portal, so it is on `document`, not in the container.
    expect(document.querySelector('a[href="/syarat-ketentuan"]')).toBeTruthy();
    expect(document.querySelector('a[href="/kebijakan-privasi"]')).toBeTruthy();
    expect(get.mock.calls.some((c) => String(c[0]).includes('/account/consents/pending'))).toBe(
      true,
    );
  });

  /*
   * `enforcement: 'UNENFORCED'` is the server promising it does nothing about this answer.
   * The screen is held to the same promise. A second modal on top of the sheet, or an
   * alertdialog that has to be answered, would be the UI enforcing what the server refuses
   * to — so the count of overlays is asserted, not the absence of one particular component.
   */
  it('blocks nothing: no extra modal, the sheet still closes, the toggles still write', async () => {
    mockAccount(OWED);
    const user = userEvent.setup();
    render(<AccountPage />, { wrapper: Providers });
    await user.click(await screen.findByText('Persetujuan data'));
    await screen.findByText('Syarat & kebijakan sudah diperbarui');

    // One dialog: the sheet the customer opened themselves. Nothing stacked on top.
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(0);

    // And the rest of the sheet is live while the notice is up.
    const sheet = document.querySelector('[role="dialog"]') as HTMLElement;
    await user.click(within(sheet).getByLabelText('Promo dan penawaran'));
    await waitFor(() =>
      expect(put.mock.calls.some((c) => (c[1] as { purpose: string }).purpose === 'MARKETING')).toBe(
        true,
      ),
    );

    // Closing it is still allowed — the notice is not a door.
    // Two carry that label: the backdrop and the X. Either one closes it; the X is the
    // one a person aims at.
    await user.click(within(sheet).getAllByLabelText('Tutup')[1]!);
    await waitFor(() => expect(document.querySelectorAll('[role="dialog"]').length).toBe(0));
  });

  // "UNENFORCED not silent". Nothing on screen would otherwise tell the customer that
  // ignoring this costs them nothing, and a prompt with no stated consequence reads as one.
  it('says out loud that ignoring it changes nothing', async () => {
    mockAccount(OWED);
    const user = userEvent.setup();
    render(<AccountPage />, { wrapper: Providers });
    await user.click(await screen.findByText('Persetujuan data'));

    expect(
      await screen.findByText((s) => s.includes('tetap aktif') && s.includes('tidak ada yang diblokir')),
    ).toBeTruthy();
  });

  // The PUT that already exists, once per owed purpose. A second write path would give the
  // ledger two shapes to be read back in.
  it('re-confirms through the existing consent PUT, one call per owed purpose', async () => {
    mockAccount(OWED);
    const user = userEvent.setup();
    render(<AccountPage />, { wrapper: Providers });
    await user.click(await screen.findByText('Persetujuan data'));
    await user.click(await screen.findByRole('button', { name: 'Setujui teks terbaru' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls.map((c) => c[1])).toEqual([
      { purpose: 'TERMS', granted: true },
      { purpose: 'PRIVACY', granted: true },
    ]);
    for (const call of put.mock.calls) {
      expect(String(call[0])).toBe('/auth/api/v1/account/consents');
    }
  });

  it('shows nothing when nothing is owed', async () => {
    mockAccount({
      documentVersion: '2026-08-29',
      purposes: [],
      mustAccept: false,
      enforcement: 'UNENFORCED',
    });
    const user = userEvent.setup();
    render(<AccountPage />, { wrapper: Providers });
    await user.click(await screen.findByText('Persetujuan data'));
    // The toggles are up, so the sheet has rendered — and the notice is not in it.
    expect(await screen.findByText('Promo dan penawaran')).toBeTruthy();
    expect(screen.queryByText('Syarat & kebijakan sudah diperbarui')).toBeNull();
  });
});

describe('/hq/pdp · fleet-wide consent lag', () => {
  const PAGE_1 = {
    documentVersion: '2026-08-29',
    totals: { population: 1200, current: 3, neverAsked: 40, refused: 12, outdated: 1190 },
    items: [
      { customerId: 'aaaaaaaa-1111-4111-8111-111111111111', neverAsked: ['PRIVACY'], refused: [], outdated: ['TERMS'] },
      { customerId: 'bbbbbbbb-2222-4222-8222-222222222222', neverAsked: [], refused: ['TERMS'], outdated: [] },
    ],
    nextCursor: 'bbbbbbbb-2222-4222-8222-222222222222',
  };
  const PAGE_2 = {
    documentVersion: '2026-08-29',
    totals: PAGE_1.totals,
    items: [
      { customerId: 'cccccccc-3333-4333-8333-333333333333', neverAsked: [], refused: [], outdated: ['PRIVACY'] },
    ],
    nextCursor: null,
  };

  beforeEach(() => {
    toast.mockReset();
    post.mockReset().mockResolvedValue({});
    getCached.mockReset().mockResolvedValue([]);
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/consents/report')) {
        return Promise.resolve(p.includes('cursor=') ? PAGE_2 : PAGE_1);
      }
      return Promise.resolve([]); // the data-subject queue
    });
  });

  it('reads the report, bounded — never the whole base in one call', async () => {
    render(<HqPdpPage />, { wrapper: Providers });
    await screen.findByText('Ketertinggalan persetujuan');
    const call = get.mock.calls.map((c) => String(c[0])).find((p) => p.includes('/consents/report'));
    expect(call).toBeTruthy();
    expect(call).toContain('limit=');
  });

  /*
   * The number that would be a lie if it were drawn as a share of a whole: 3 + 40 + 12 +
   * 1190 is 1245 against a population of 1200, because the last three overlap. Every total
   * is printed as its own figure and the overlap is stated.
   */
  it('prints all five totals as figures, and says they do not add up', async () => {
    render(<HqPdpPage />, { wrapper: Providers });
    expect(await screen.findByText('1200')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('1190')).toBeTruthy();
    expect(
      screen.getByText((s) => s.includes('tumpang tindih') && s.includes('tidak berjumlah')),
    ).toBeTruthy();
  });

  // Day one reads as ~100% outdated because the migration backfilled every row at '1.0'.
  // Without this sentence the screen is an incident report about a correct answer.
  it('explains the day-one backfill instead of raising an alarm', async () => {
    render(<HqPdpPage />, { wrapper: Providers });
    expect(
      await screen.findByText((s) => s.includes('"1.0"') && s.includes('bukan tanda bahaya')),
    ).toBeTruthy();
  });

  it('keeps "never asked" and "refused" apart, on the rows and in words', async () => {
    render(<HqPdpPage />, { wrapper: Providers });
    expect(await screen.findByText('Belum pernah ditanya: Kebijakan privasi & pemrosesan data'))
      .toBeTruthy();
    expect(screen.getByText('Menolak: Syarat & ketentuan layanan')).toBeTruthy();
    expect(
      screen.getByText((s) => s.includes('bukan "Menolak"') && s.includes('tidak boleh digabung')),
    ).toBeTruthy();
  });

  it('pages with nextCursor, and stops when the server says there is no next', async () => {
    const user = userEvent.setup();
    render(<HqPdpPage />, { wrapper: Providers });
    await screen.findByText('Halaman 1');

    await user.click(screen.getByRole('button', { name: 'Berikutnya' }));
    await waitFor(() =>
      expect(
        get.mock.calls.some((c) =>
          String(c[0]).includes(`cursor=${encodeURIComponent(PAGE_1.nextCursor)}`),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('cccccccc')).toBeTruthy();

    // nextCursor is null on the last page, and the pager has to believe it.
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Berikutnya' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    await user.click(screen.getByRole('button', { name: 'Sebelumnya' }));
    expect(await screen.findByText('Halaman 1')).toBeTruthy();
  });
});
