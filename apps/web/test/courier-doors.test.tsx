// @vitest-environment jsdom
/**
 * Fase O · three doors in the courier app that were shut, mislabelled, or hidden.
 *
 * O3  Delivery history was the one list in the app whose rows were plain divs. The detail
 *     route already existed, was already allowed by the same guard as the list, and six
 *     other courier screens already linked to it — only the tap target was missing.
 * O8  The "Depot penempatan" row showed no depot name at all, and tapping it opened
 *     Announcements. A courier checking which depot they belong to was answered with
 *     "Belum ada pengumuman", which reads as "you have no depot". And one concept carried
 *     three different names across the consoles, with no sentence anywhere saying what it
 *     actually governs.
 * O10 Depositing the shift's cash was reachable from exactly one place in the whole app: a
 *     row on the Profile screen. The flow itself has always been complete.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { push, get } = vi.hoisted(() => ({ push: vi.fn(), get: vi.fn() }));
let customer: { id: string; role: string; assignedDepotId?: string | null } | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/driver/profile',
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer, ready: true, signOut: vi.fn() }) }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get } };
});
// The courier shell renders a nav that needs neither of the things under test here.
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { LocaleProvider } from '@/lib/locale-context';
import { id as idDict } from '@/lib/dictionaries/id';
import { en as enDict } from '@/lib/dictionaries/en';
import HistoryPage from '@/app/driver/history/page';
import ProfilePage from '@/app/driver/profile/page';
import EarningsPage from '@/app/driver/earnings/page';

const DELIVERY = {
  id: 'del-1',
  orderNumber: 'HM-1001',
  status: 'DELIVERED',
  destinationAddress: 'Jl. Merdeka 10',
  deliveredAt: '2026-08-20T02:00:00Z',
  failedAt: null,
  assignedAt: '2026-08-20T01:00:00Z',
  failureReason: null,
};

beforeEach(() => {
  push.mockReset();
  get.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  customer = { id: 's1', role: 'STAFF_DEPOT', assignedDepotId: 'depot-1' };
});
afterEach(() => vi.clearAllMocks());

describe('O3 · a courier can open a past delivery', () => {
  it('links each history row to the delivery detail that already exists', async () => {
    get.mockImplementation(async (path: string) =>
      path.includes('DELIVERED')
        ? { items: [DELIVERY], total: 1, page: 1, limit: 20 }
        : { items: [], total: 0, page: 1, limit: 20 },
    );

    render(<HistoryPage />, { wrapper: LocaleProvider });

    const row = await screen.findByRole('link', { name: /HM-1001/ });
    expect(row.getAttribute('href')).toBe('/driver/deliveries/detail?id=del-1');
  });
});

describe('O8 · the placement row answers the question it asks', () => {
  it('shows the depot name, resolved from the public depot list', async () => {
    get.mockResolvedValue({ items: [{ id: 'depot-1', name: 'Depot Bandung Kota' }], total: 1, page: 1, limit: 100 });

    render(<ProfilePage />, { wrapper: LocaleProvider });

    await waitFor(() => expect(screen.getByText('Depot Bandung Kota')).toBeTruthy());
  });

  it('says what the placement governs', async () => {
    render(<ProfilePage />, { wrapper: LocaleProvider });
    expect(screen.getByText(idDict.driver.profile.depotPlacementHint)).toBeTruthy();
  });

  it('no longer opens Announcements — it is a fact, not a screen', async () => {
    get.mockResolvedValue({ items: [{ id: 'depot-1', name: 'Depot Bandung Kota' }], total: 1, page: 1, limit: 100 });
    render(<ProfilePage />, { wrapper: LocaleProvider });

    await waitFor(() => expect(screen.getByText('Depot Bandung Kota')).toBeTruthy());
    // Whatever else this screen offers, nothing about the placement row leads to /driver/announcements.
    const placement = screen.getByText(idDict.driver.profile.depotPlacement).closest('div');
    expect(placement?.querySelector('button')).toBeNull();
  });
});

describe('O8 · one concept, one name', () => {
  it('the courier app, the HQ console and the HR form all call it the same thing', () => {
    const idNames = new Set([
      idDict.driver.profile.depotPlacement,
      idDict.hq.staff.depot,
      idDict.hrFix.employeeForm.depot,
    ]);
    expect([...idNames]).toEqual(['Depot penempatan']);

    const enNames = new Set([
      enDict.driver.profile.depotPlacement,
      enDict.hq.staff.depot,
      enDict.hrFix.employeeForm.depot,
    ]);
    expect([...enNames]).toEqual(['Assigned depot']);
  });

  it('both dictionaries carry the explaining sentence', () => {
    expect(idDict.driver.profile.depotPlacementHint).toBeTruthy();
    expect(enDict.driver.profile.depotPlacementHint).toBeTruthy();
  });
});

describe('O10 · the deposit door is on the wallet, not only in Profile', () => {
  it('links the wallet home to the settlement flow', async () => {
    // The wallet screen renders a skeleton until its summary lands.
    get.mockResolvedValue({
      availableBalance: 0,
      monthEarnings: 0,
      recentEntries: [],
      recentWithdrawals: [],
    });
    render(<EarningsPage />, { wrapper: LocaleProvider });

    const link = await screen.findByRole('link', { name: new RegExp(idDict.hrFix.earnings.settleCash, 'i') });
    expect(link.getAttribute('href')).toBe('/driver/settlement');
  });
});
