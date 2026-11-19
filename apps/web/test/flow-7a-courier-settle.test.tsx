// @vitest-environment jsdom
/**
 * Flow plan PR-7a · the courier's way to the cash hand-in.
 *
 * After the last stop the success screen offered only "next task" (which, with no next
 * stop, went to the task list) — the hand-in was two screens away behind Profile or the
 * Dompet tab, and the Dompet tab only appeared once the courier was already in the wallet.
 * Now: the last stop offers "Setor sekarang"; the hand-in screen, when the shift is still
 * open, offers to close it; closing a shift lands on the hand-in; and Dompet is always a tab.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { push, replace, get, post, nav, query } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  nav: { path: '/driver/' },
  query: { queued: null as string | null },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 's1', role: 'STAFF_DEPOT', fullName: 'Kurir', phone: '0811' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: async () => true }) }));
vi.mock('@/lib/use-query-param', () => ({
  useQueryParam: (k: string) => (k === 'id' ? 'del-1' : k === 'queued' ? query.queued : null),
}));
vi.mock('@/lib/geo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/geo')>('@/lib/geo');
  return { ...actual, currentPosition: async () => ({ coords: { latitude: -6.2, longitude: 106.8 } }) };
});
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post } };
});

import { DriverShell } from '@/components/driver/driver-shell';
import SuccessPage from '@/app/driver/deliveries/detail/success/page';
import SettlementPage from '@/app/driver/settlement/page';
import ShiftStatusPage from '@/app/driver/shift/status/page';

const DELIVERED = {
  id: 'del-1',
  orderNumber: 'HM-1',
  status: 'DELIVERED',
  deliveredAt: '2026-11-19T02:00:00Z',
  proof: null,
};
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 20 });
const shift = (id: string, status: string) => ({
  id,
  status,
  checkInAt: '2026-11-19T01:00:00Z',
  checkOutAt: status === 'ENDED' ? '2026-11-19T09:00:00Z' : null,
  breakSecondsRemaining: 0,
});

beforeEach(() => {
  nav.path = '/driver/';
  query.queued = null;
  push.mockReset();
  replace.mockReset();
  post.mockReset().mockResolvedValue({});
  get.mockReset();
});
afterEach(() => vi.clearAllMocks());

const tabs = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'));

describe('Dompet is always a tab', () => {
  it.each(['/driver/', '/driver/history/', '/driver/profile/'])('on %s', (path) => {
    nav.path = path;
    render(<DriverShell>x</DriverShell>);
    expect(tabs()).toEqual(['/driver', '/driver/history', '/driver/earnings', '/driver/profile']);
    expect(screen.getByText('driver.shell.tabWallet').closest('a')?.getAttribute('aria-current')).toBeNull();
  });

  it('and is the current tab on every wallet screen', () => {
    nav.path = '/driver/expenses/';
    render(<DriverShell>x</DriverShell>);
    expect(screen.getByText('driver.shell.tabWallet').closest('a')?.getAttribute('aria-current')).toBe('page');
  });
});

describe('after the last stop the courier is sent to hand in the cash', () => {
  const answer = (list: unknown) =>
    get.mockImplementation(async (path: string) => (path.includes('del-1') ? DELIVERED : list));

  it('no stop left: "Setor sekarang" opens the hand-in', async () => {
    answer(page([DELIVERED, { id: 'del-2', status: 'DELIVERED' }]));
    render(<SuccessPage />);
    fireEvent.click(await screen.findByText('courierFix.podSuccess.settleNow'));
    expect(replace).toHaveBeenCalledWith('/driver/settlement');
    expect(screen.queryByText('courierFix.podSuccess.next')).toBeNull();
  });

  it('a stop left: the next task, as before', async () => {
    answer(page([{ id: 'del-3', status: 'ASSIGNED' }]));
    render(<SuccessPage />);
    fireEvent.click(await screen.findByText('courierFix.podSuccess.next'));
    expect(replace).toHaveBeenCalledWith('/driver/deliveries/detail?id=del-3');
    // Asked of the open stops alone, not of the newest 20 rows of every status.
    expect(get).toHaveBeenCalledWith(expect.stringContaining('statuses=ASSIGNED,PICKED_UP,ON_DELIVERY'), true);
    expect(screen.queryByText('courierFix.podSuccess.settleNow')).toBeNull();
  });

  it('a queued proof: the stop is still open on the server — no claim', async () => {
    // Offline PoD: this very delivery is still ON_DELIVERY server-side, so an empty list
    // (once this stop is set aside) does not mean it was the last one.
    query.queued = '1';
    answer(page([{ id: 'del-1', status: 'ON_DELIVERY' }]));
    render(<SuccessPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(await screen.findByText('courierFix.podSuccess.next'));
    expect(replace).toHaveBeenCalledWith('/driver');
    expect(screen.queryByText('courierFix.podSuccess.settleNow')).toBeNull();
  });

  it('the list still loading: the button waits rather than change under the finger', async () => {
    let resolve: (v: unknown) => void = () => {};
    get.mockImplementation((path: string) =>
      path.includes('del-1') && !path.includes('statuses') ? Promise.resolve(DELIVERED) : new Promise((r) => (resolve = r)),
    );
    render(<SuccessPage />);
    const button = (await screen.findByText('courierFix.podSuccess.next')).closest('button')!;
    expect(button.disabled).toBe(true);
    resolve(page([]));
    await waitFor(() => expect(screen.getByText('courierFix.podSuccess.settleNow').closest('button')!.disabled).toBe(false));
  });

  it('the task list unread: no claim either way — the list, as before', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('del-1')) return DELIVERED;
      throw new Error('offline');
    });
    render(<SuccessPage />);
    fireEvent.click(await screen.findByText('courierFix.podSuccess.next'));
    expect(replace).toHaveBeenCalledWith('/driver');
    expect(screen.queryByText('courierFix.podSuccess.settleNow')).toBeNull();
  });
});

describe('the hand-in screen while the shift is still open', () => {
  const answer = (shifts: unknown[]) =>
    get.mockImplementation(async (path: string) => (path.endsWith('/driver/shifts') ? shifts : []));

  it('offers to close the shift', async () => {
    // The ended shift is settled already: the open one is all there is.
    get.mockImplementation(async (path: string) =>
      path.endsWith('/driver/shifts')
        ? [shift('sh-2', 'ONLINE'), shift('sh-1', 'ENDED')]
        : path.endsWith('/driver/settlement')
          ? [{ shiftId: 'sh-1' }]
          : [],
    );
    render(<SettlementPage />);
    fireEvent.click(await screen.findByText('hrFix.settlement.closeShift'));
    // Replaced, not pushed: check-out lands back here, and one hand-in screen is enough history.
    expect(replace).toHaveBeenCalledWith('/driver/shift/status');
  });

  it('offers it beside an older shift still owed, which is not today’s cash', async () => {
    get.mockImplementation(async (path: string) =>
      path.endsWith('/driver/shifts')
        ? [shift('sh-2', 'ONLINE'), shift('sh-1', 'ENDED')]
        : path.includes('/expected/')
          ? { shiftId: 'sh-1', expectedIdr: 50000 }
          : [],
    );
    render(<SettlementPage />);
    expect(await screen.findByText('hrFix.settlement.openShiftNote')).toBeTruthy();
    fireEvent.click(screen.getByText('hrFix.settlement.closeShift'));
    expect(replace).toHaveBeenCalledWith('/driver/shift/status');
  });

  it('says nothing about closing when no shift is open', async () => {
    answer([]);
    render(<SettlementPage />);
    await screen.findByText('hrFix.settlement.nothingToSettle');
    expect(screen.queryByText('hrFix.settlement.closeShift')).toBeNull();
  });
});

describe('closing a shift', () => {
  it('lands on the hand-in, where its cash is settled', async () => {
    get.mockResolvedValue(shift('sh-2', 'ONLINE'));
    render(<ShiftStatusPage />);
    fireEvent.click(await screen.findByText('driver.shiftStatus.checkOut'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/driver/settlement'));
  });
});
